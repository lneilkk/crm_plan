#!/usr/bin/env bash
#
# 비밀정보 스캔 — 커밋 이력에 키·토큰·비밀번호가 있는지 gitleaks로 검사한다. (CLAUDE.md 절대 규칙 2)
#
# CI(.github/workflows/ci.yml의 secrets job)와 로컬이 이 스크립트 하나를 같이 쓴다.
# gitleaks는 아래에 고정한 버전의 공식 이미지를 Docker로 실행하므로 따로 설치할 필요가 없다.
#
# 사용법:
#   scripts/ci/secret-scan.sh                     현재 저장소의 모든 브랜치 전체 이력
#   scripts/ci/secret-scan.sh origin/main..HEAD   지정한 범위의 커밋만 (git log 범위 표기)
#   scripts/ci/secret-scan.sh HEAD                그 커밋까지의 전체 이력
#
# 종료 코드: 0 = 발견 없음, 1 = 비밀정보 발견, 2 = 실행 환경 문제(Docker 없음 등)
#
# 작업 폴더의 현재 내용이 아니라 커밋 하나하나를 두 번에 나누어 검사한다.
#   1) 변경분(파일 내용) — 나중 커밋에서 지운 키도 이력에 남아 있으면 잡힌다.
#   2) 커밋 메시지 — gitleaks의 git 스캔은 변경분만 보므로 메시지는 따로 검사한다.
# 검사하지 않는 것: 태그 메시지, git notes, 작성자 이름·이메일.
# 진짜 키가 잡혔다면 이력에서 지우는 것으로 끝내지 말고 그 키를 폐기·재발급한다.

set -euo pipefail

# gitleaks 버전 고정: 태그와 이미지 다이제스트를 함께 적는다. (다이제스트가 실제로 받는 이미지를 결정한다)
GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

if [ "$#" -gt 1 ]; then
  echo "사용법: $0 [<git log 범위 또는 커밋>]   예) $0 origin/main..HEAD" >&2
  exit 2
fi
range="${1:-}"
if [[ "$range" == -* || "$range" == *[[:space:]]* ]]; then
  echo "git log 범위(A..B)나 커밋 하나만 받는다: $range" >&2
  exit 2
fi

# 설정 파일은 항상 이 스크립트가 들어 있는 저장소의 것을 쓴다.
config="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.gitleaks.toml"
# 검사 대상은 현재 위치의 git 저장소다.
repo="$(git rev-parse --show-toplevel)"

if [ ! -f "$config" ]; then
  echo "gitleaks 설정 파일이 없다: $config" >&2
  exit 2
fi
if [ ! -d "$repo/.git" ]; then
  echo "git worktree에서는 실행할 수 없다(.git 폴더가 컨테이너에 보이지 않는다). 원본 저장소에서 실행한다." >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker가 필요하다(gitleaks를 컨테이너로 실행한다)." >&2
  exit 2
fi

# gitleaks는 --log-opts를 주면 기본 옵션(--full-history --all) 대신 그 값만 git log에 넘긴다.
# --diff-merges=first-parent: 병합 커밋의 변경분도 검사한다. 이 옵션이 없으면 git log -p가 병합 커밋의
# 변경분을 출력하지 않아서, 충돌을 해결하다 병합 커밋에만 들어간 키를 놓친다.
log_opts="--full-history --diff-merges=first-parent ${range:---all}"

# 저장소와 설정은 읽기 전용으로 붙이고, 네트워크 없이, 현재 사용자 권한으로 실행한다.
in_container() {
  local entrypoint="$1"
  shift
  docker run --rm \
    --network none \
    --user "$(id -u):$(id -g)" \
    --volume "$repo:/repo:ro" \
    --volume "$config:/gitleaks.toml:ro" \
    --entrypoint "$entrypoint" \
    "$GITLEAKS_IMAGE" "$@"
}

# 사전 점검: gitleaks는 git log가 실패해도(없는 커밋, 저장소 읽기 실패) '발견 없음'(종료 코드 0)으로 끝난다.
# 그래서 같은 컨테이너 환경에서 git이 저장소와 범위를 읽을 수 있는지 먼저 확인한다.
if ! in_container git -C /repo rev-list --max-count=1 "${range:---all}" >/dev/null; then
  echo "git이 저장소나 범위를 읽지 못했다: ${range:-전체 이력}" >&2
  exit 2
fi

# gitleaks 출력을 보여 주고 종료 코드를 정리한다: 0 = 발견 없음, 1 = 발견, 2 = 스캔이 제대로 돌지 않음.
# gitleaks가 오류(ERR·FTL)를 기록했는데 발견 보고가 없으면 스캔이 제대로 돌지 않은 것이다.
# (git log 실패는 종료 코드 0, 설정 파일 오류는 종료 코드 1로 끝나므로 종료 코드만으로는 구분할 수 없다)
run_scan() {
  local output code=0
  output="$("$@" 2>&1)" || code=$?
  printf '%s\n' "$output"
  if grep -Eq '^[0-9]{1,2}:[0-9]{2}(AM|PM) (ERR|FTL) ' <<<"$output" && ! grep -Eq ' WRN leaks found: [0-9]+' <<<"$output"; then
    return 2
  fi
  case "$code" in
    0 | 1) return "$code" ;;
    *) return 2 ;;
  esac
}

# --redact: 발견한 값을 화면과 CI 로그에 그대로 찍지 않는다.
gitleaks_flags="--config /gitleaks.toml --redact --verbose --no-banner --no-color --exit-code 1"

# 1) 커밋 변경분.
echo "== 커밋 변경분 스캔 =="
patch_status=0
# shellcheck disable=SC2086 # gitleaks_flags는 일부러 낱말로 나눈다.
run_scan in_container gitleaks git $gitleaks_flags --log-opts "$log_opts" /repo || patch_status=$?

# 2) 커밋 메시지. 같은 컨테이너 안에서 git log의 메시지를 gitleaks stdin으로 넘긴다.
#    pipefail: git log가 실패하면 '발견 없음'이 아니라 실패로 끝낸다(125 → 종료 코드 2).
echo "== 커밋 메시지 스캔 =="
message_status=0
# shellcheck disable=SC2016 # $1·$2는 컨테이너 안의 sh가 펼친다.
run_scan in_container sh -c '
  set -o pipefail
  git -C /repo log --full-history --format=%B "$1" | gitleaks stdin $2 || exit $?
' sh "${range:---all}" "$gitleaks_flags" || message_status=$?

# 둘 중 하나라도 스캔 실패(2)면 2, 아니면 발견(1)이 있으면 1.
status=0
if [ "$patch_status" -eq 2 ] || [ "$message_status" -eq 2 ]; then
  status=2
elif [ "$patch_status" -eq 1 ] || [ "$message_status" -eq 1 ]; then
  status=1
fi

case "$status" in
  0) ;;
  1)
    echo "비밀정보가 발견되었다. 진짜 키라면 즉시 폐기·재발급하고, 오탐이라면 .gitleaks.toml의 안내대로 좁게 허용한다." >&2
    ;;
  *)
    # Docker·git·gitleaks 자체가 실패한 경우. '발견 없음'으로 넘어가지 않게 실패로 끝낸다.
    echo "gitleaks 실행에 실패했다. 위 출력의 오류를 확인한다." >&2
    ;;
esac
exit "$status"
