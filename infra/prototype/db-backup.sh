#!/usr/bin/env bash
# 프로토타입 서버 DB를 서버 안에 백업한다(pg_dump custom 형식, 권한 600). 업데이트(마이그레이션) 전에 돌린다. 관리자 PC 전용.
#   infra/prototype/db-backup.sh [이름표=backup]   → 서버 /opt/crm/backups/<이름표>-<한국시각>.dump
# 백업 파일은 서버에만 둔다(이 PC로 내려받지 않는다). 출력에는 파일 이름·크기·테이블 수만 나온다.
set -euo pipefail
LABEL="${1:-backup}"
[[ "$LABEL" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "이름표는 영문·숫자·-·_만" >&2; exit 1; }
REMOTE=$(cat <<SCRIPT
set -euo pipefail
cd /opt/crm/app; set -a; . ./.env; set +a; umask 077
mkdir -p /opt/crm/backups
F=/opt/crm/backups/$LABEL-\$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S).dump
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" -Fc > "\$F"
ls -l "\$F"
echo "테이블 데이터 \$(docker compose -f docker-compose.prod.yml exec -T db pg_restore --list < "\$F" | grep -c 'TABLE DATA')개"
SCRIPT
)
B64=$(printf '%s' "$REMOTE" | base64 -w0)
exec "$(dirname "$0")/ssm-run.sh" "echo $B64 | base64 -d > /tmp/crm-db-backup.sh && bash /tmp/crm-db-backup.sh; rc=\$?; rm -f /tmp/crm-db-backup.sh; exit \$rc" 600
