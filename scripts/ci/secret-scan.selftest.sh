#!/usr/bin/env bash
#
# 비밀정보 스캔 자체 점검 — secret-scan.sh가 '키가 포함된 커밋'을 실제로 실패시키는지 확인한다. (T0-4 완료 기준)
#
# .tmp/T0-4/selftest/(git 제외) 안에 일회용 git 저장소를 만들어 가짜 키를 커밋하고 스캔한 뒤 지운다.
# 가짜 키는 실행할 때마다 무작위로 만든다. 어디에도 유효하지 않은 값이고, 추적되는 파일에는 적지 않는다.
#
# CI의 secrets job이 실제 스캔 전에 이 점검을 먼저 돌린다(러너 환경에서 스캔이 조용히 통과해 버리는 일을 막는다).
# gitleaks 버전이나 .gitleaks.toml을 바꾼 뒤에는 로컬에서도 한 번 돌린다:  scripts/ci/secret-scan.selftest.sh

set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scan="$root/scripts/ci/secret-scan.sh"
work="$root/.tmp/T0-4/selftest"
trap 'rm -rf "$work"; rmdir "$root/.tmp/T0-4" 2>/dev/null || true' EXIT
rm -rf "$work"
mkdir -p "$work"

random_chars() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2"; }
fake_token="ghp_$(random_chars 'A-Za-z0-9' 36)" # GitHub 토큰 모양
fake_aws_key="AKIA$(random_chars 'A-Z2-7' 16)" # AWS 액세스 키 모양
fake_db_password="$(random_chars 'A-Za-z0-9' 24)"
missing_commit="0000000000000000000000000000000000000000"

new_repo() {
  mkdir -p "$work/$1"
  cd "$work/$1" || exit 2
  git init -q -b main .
  git config user.name "selftest"
  git config user.email "selftest@example.invalid"
  git config commit.gpgsign false
  commit_file README.md "일회용 저장소" "초기 커밋"
}
commit_file() {
  printf '%s\n' "$2" >"$1"
  git add -A
  git commit -q -m "$3"
}

failed=0
# expect <설명> <기대 종료 코드> <명령...> — 스캔 출력은 실패했을 때만 보여 준다.
expect() {
  local label="$1" want="$2" output got=0
  shift 2
  output="$("$@" 2>&1)" || got=$?
  if [ "$got" -eq "$want" ]; then
    echo "통과  $label (종료 코드 $got)"
  else
    echo "실패  $label (종료 코드 $got, 기대 $want)"
    printf '%s\n' "$output"
    failed=1
  fi
}

new_repo clean
expect "깨끗한 저장소는 통과한다" 0 "$scan"
expect "없는 커밋을 범위로 주면 통과로 처리하지 않는다" 2 "$scan" "$missing_commit..HEAD"

new_repo token
commit_file config.ts "export const token = \"${fake_token}\";" "설정 추가"
expect "토큰이 든 커밋은 실패한다" 1 "$scan"

new_repo aws
commit_file deploy.env "AWS_ACCESS_KEY_ID=${fake_aws_key}" "배포 설정"
expect "AWS 키가 든 커밋은 실패한다" 1 "$scan"

new_repo db-url
commit_file db.ts "const url = \"postgresql://crm:${fake_db_password}@127.0.0.1:5432/crm\";" "DB 연결"
expect "비밀번호가 든 DB 접속 주소는 실패한다" 1 "$scan"

# 자리표시자만 통과한다. 소문자 password 같은 약한 실제 비밀번호는 자리표시자가 아니다.
new_repo db-url-placeholder
commit_file env.example "# 형식: postgresql://USER:PASSWORD@127.0.0.1:PORT/DB" "형식 설명"
# shellcheck disable=SC2016 # ${...}를 펼치지 않고 글자 그대로 커밋한다.
commit_file env.ts 'const url = `postgresql://${user}:${dbPassword}@127.0.0.1:5432/crm`;' "변수로 조립"
expect "자리표시자만 적힌 DB 접속 주소는 통과한다" 0 "$scan"
for weak in password Password crm; do
  new_repo "db-url-weak-$weak"
  commit_file db.env "DATABASE_URL=postgresql://crm:${weak}@db:5432/crm" "DB 연결"
  expect "약한 비밀번호(${weak})가 든 DB 접속 주소도 실패한다" 1 "$scan"
done

# 변경분은 깨끗하고 커밋 메시지에만 키가 있는 경우.
new_repo message-only
base="$(git rev-parse HEAD)"
commit_file ok.ts "export const ok = true;" "임시 토큰 ${fake_token} 으로 확인함"
commit_file ok2.ts "export const ok2 = true;" "정상 커밋"
expect "커밋 메시지에만 있는 키도 잡힌다 (전체 이력)" 1 "$scan"
expect "커밋 메시지에만 있는 키도 잡힌다 (범위)" 1 "$scan" "$base..HEAD"
expect "메시지에 키가 없는 범위는 통과한다" 0 "$scan" "HEAD~1..HEAD"

new_repo removed-later
base="$(git rev-parse HEAD)"
commit_file secret.ts "const key = \"${fake_token}\";" "키 추가"
git rm -q secret.ts
git commit -q -m "키 제거"
commit_file ok.ts "export const ok = true;" "정상 코드"
expect "앞선 커밋에 넣었다가 지운 키도 범위 스캔에서 잡힌다" 1 "$scan" "$base..HEAD"
expect "키가 없는 커밋만 있는 범위는 통과한다" 0 "$scan" "HEAD~1..HEAD"

new_repo merge-only
base="$(git rev-parse HEAD)"
commit_file a.txt a "main 변경"
git checkout -q -b side "$base"
commit_file b.txt b "side 변경"
git checkout -q main
git merge -q --no-ff --no-commit side >/dev/null 2>&1
commit_file merged.ts "const key = \"${fake_token}\";" "병합"
expect "병합 커밋에만 들어간 키도 잡힌다" 1 "$scan" "$base..HEAD"

if [ "$failed" -ne 0 ]; then
  echo "자체 점검 실패: 비밀정보 스캔이 기대대로 동작하지 않는다." >&2
  exit 1
fi
echo "자체 점검 통과"
