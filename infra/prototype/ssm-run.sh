#!/usr/bin/env bash
# 프로토타입 서버에 SSM으로 셸 명령을 보내고 결과를 출력한다(SSH 없이). 관리자 PC 전용.
#   infra/prototype/ssm-run.sh '명령' [제한초=900]
# 접근 키는 저장소의 .secrets/aws(git 제외)에서 읽는다. 출력에 비밀값을 찍는 명령을 보내지 않는다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export AWS_SHARED_CREDENTIALS_FILE="$ROOT/.secrets/aws/credentials" AWS_CONFIG_FILE="$ROOT/.secrets/aws/config" AWS_PROFILE=crm
INSTANCE_ID="${CRM_PROTO_INSTANCE_ID:-$(aws ec2 describe-instances --filters Name=tag:Name,Values=crm-proto Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)}"
TIMEOUT="${2:-900}"
PARAMS=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]],"executionTimeout":[sys.argv[2]]}))' "$1" "$TIMEOUT")
CID=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --parameters "$PARAMS" --timeout-seconds 60 --query Command.CommandId --output text)
while :; do
  STATUS=$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Pending|InProgress|Delayed) sleep 5 ;; *) break ;; esac
done
aws ssm get-command-invocation --command-id "$CID" --instance-id "$INSTANCE_ID" --query '[StandardOutputContent,StandardErrorContent]' --output text
echo "== $STATUS"
[ "$STATUS" = "Success" ]
