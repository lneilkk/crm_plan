# 배포 안내 (T10-1)

치과 CRM을 Docker 이미지로 만들어 서버에서 띄우는 방법이다.
R1~R2는 외부 프로토타입 서버에서 Docker Compose로 띄우고, R3에서 같은 파일로 AWS(EC2 t4g, arm64)로 옮긴다.

관련 파일

| 파일 | 내용 |
| --- | --- |
| `Dockerfile` | 다단계 빌드. `runtime`(앱, 기본 대상)과 `migrate`(마이그레이션·시드 도구) 두 이미지를 만든다 |
| `.dockerignore` | `.env*`, `.data`, `.tmp`, `.cache`, `node_modules`, `.git`, 테스트 산출물을 빌드에서 뺀다 |
| `docker-compose.prod.yml` | 운영 구성: `db`(postgres:17-alpine), `migrate`(한 번 실행), `app` |
| `scripts/docker/healthcheck.mjs` | 이미지의 HEALTHCHECK가 실행하는 스크립트(`/api/health` 호출) |
| `src/app/api/health/route.ts` | 헬스체크 API |

로컬 개발용 `docker-compose.yml`(DB만 띄움)과는 별개 파일이다. 두 파일을 같은 프로젝트 이름으로 섞어 쓰지 않는다(아래 "주의" 참고).

---

## 1. 환경변수

이름은 `.env.example`과 같다. 실제 값은 서버의 `.env`(git 제외, 권한 600)에만 둔다. 이 문서·저장소·이미지에 실제 값을 적지 않는다(절대 규칙 2).

### 서버의 `.env`에 적는 값

| 이름 | 뜻 | 운영 필수 | 값의 형태(예시는 모양만) |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | Compose 프로젝트 이름. 컨테이너·볼륨 이름 앞에 붙는다 | 권장 | `crm_prod` |
| `POSTGRES_USER` | DB 계정 이름 | 필수 | `crm` |
| `POSTGRES_DB` | DB 이름 | 필수 | `crm` |
| `POSTGRES_PASSWORD` | DB 비밀번호. 접속 주소에 그대로 들어가므로 base64url 문자(A-Z a-z 0-9 - _)만 쓴다. DB를 처음 만들 때만 적용된다 | 필수 | 무작위 32자 내외 (`openssl rand -base64 24 \| tr '+/' '-_'`) |
| `PII_ENC_KEY` | 전화번호·생년월일 암호화 키(AES-256-GCM). 무작위 32바이트 base64. 잃어버리면 복호화할 수 없다 | 필수 | `openssl rand -base64 32` 결과 |
| `PII_HMAC_KEY` | 전화번호 검색용 해시 키(HMAC). 무작위 32바이트 base64. `PII_ENC_KEY`와 달라야 한다 | 필수 | `openssl rand -base64 32` 결과 |
| `APP_PORT` | 앱이 열리는 호스트 포트(127.0.0.1에만 열림). 리버스 프록시가 이 포트로 넘긴다 | 선택 (기본 3100) | `3100` |
| `TRUSTED_PROXY_HOPS` | 앞단 프록시 수. 감사 로그의 접속 IP를 `X-Forwarded-For`에서 읽을 때 쓴다. 프록시(Caddy) 1대 뒤면 `1`, 없으면 비우거나 `0` | 프록시 뒤면 필수 | `1` |
| `SEED_STAFF_PASSWORD` | 시드가 만드는 역할별 테스트 계정 비밀번호. 프로토타입(가짜 데이터) 서버에서만 쓴다 | 프로토타입만 | 무작위 문자열 |
| `FAKE_DATA_ALLOWED` | 테스트 계정·가짜 데이터 허용. 프로토타입 서버에서만 `true`. **실제 운영에서는 절대 두지 않는다** | 프로토타입만 | `true` 또는 없음 |

### 운영 Compose가 대신 정하는 값 (`.env`에 적어도 무시됨)

| 이름 | 값 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://POSTGRES_USER:POSTGRES_PASSWORD@db:5432/POSTGRES_DB` | `docker-compose.prod.yml`이 위 값으로 조립해 `app`·`migrate`에 넣는다. 개발용 `.env`의 `127.0.0.1` 주소는 컨테이너 안에서 쓸 수 없기 때문이다 |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | 컨테이너 안의 서버 주소 |
| `NODE_ENV` | `production` | 이미지에 고정. 세션 쿠키에 `Secure`가 붙으므로 **HTTPS로만 로그인할 수 있다** |
| `NEXT_TELEMETRY_DISABLED` | `1` | 이미지에 고정 |

### 개발 PC에서만 쓰는 값 (운영 서버에는 필요 없음)

`POSTGRES_PORT`(로컬 DB 포트), `HOST_UID`/`HOST_GID`(로컬 DB 컨테이너 실행 사용자), `DATABASE_URL`(로컬 개발·스크립트용 주소).

---

## 2. 이미지 빌드

### amd64 (이 개발 서버에서 확인함)

```bash
docker build -t crm_plan_app:local .                      # 앱 (runtime, 기본 대상)
docker build --target migrate -t crm_plan_migrate:local . # 마이그레이션·시드 도구
```

빌드 안에서 `npm ci`가 패키지를 새로 받으므로 npm 레지스트리, Prisma 엔진 다운로드(binaries.prisma.sh), Debian 패키지 저장소에 접속할 수 있어야 한다.

### arm64 (EC2 t4g용)

```bash
docker buildx build --platform linux/arm64 -t crm_plan_app:arm64 --load .
docker buildx build --platform linux/arm64 --target migrate -t crm_plan_migrate:arm64 --load .
```

**이 명령은 이 개발 서버에서 실행하지 않았다.** 이 서버에는 buildx와 QEMU가 없다. arm64 서버(EC2 t4g)에서 직접 `docker build`를 하거나, buildx와 QEMU가 있는 PC에서 위 명령으로 빌드한다.

Dockerfile은 CPU 종류에 묶이지 않게 만들었다.

- 베이스 이미지 `node:22-bookworm-slim`은 amd64·arm64 둘 다 있다.
- Prisma 7 + pg 어댑터는 네이티브 쿼리 엔진을 쓰지 않는다. 쿼리 컴파일러는 wasm이다(앱 이미지에 `.node` 엔진 파일 없음을 확인함).
- 네이티브 파일은 `@node-rs/argon2`(비밀번호 해시)와 migrate 이미지의 Prisma `schema-engine`뿐이다. 둘 다 이미지 안의 `npm ci`가 빌드 플랫폼에 맞게 받는다. `package-lock.json`에 `@node-rs/argon2-linux-arm64-gnu`가 들어 있다. 호스트의 `node_modules`는 `.dockerignore`로 빠지므로 복사되지 않는다.

### 이미지 구성

| 단계 | 내용 |
| --- | --- |
| `deps` | openssl 설치(Prisma CLI용), `npm ci` |
| `build` | `prisma generate` + `next build` (`next.config.ts`의 `output: "standalone"`) |
| `migrate` | `deps` + `prisma/`(스키마·마이그레이션·시드) + 시드가 쓰는 `src/lib`, `src/server`. 기본 명령 `prisma migrate deploy`. 개발 도구가 함께 들어 있어 크다(약 1.5GB). 한 번 실행하고 지운다 |
| `runtime` | `.next/standalone`, `.next/static`, `public/`(없으면 빈 폴더), 헬스체크 스크립트만. 약 300MB. `USER node`(uid 1000), 파일은 root 소유·읽기 전용, `EXPOSE 3000`, `HEALTHCHECK` |

이미지에는 `.env`가 없다. 비밀값은 실행할 때 `env_file`로만 들어간다. 시드 전용 값(`SEED_STAFF_PASSWORD`, `FAKE_DATA_ALLOWED`)은 `migrate`에만 들어가고, `app`에서는 빈 값으로 덮어쓴다. 그래도 시드를 마친 뒤에는 서버 `.env`에서 `SEED_STAFF_PASSWORD`를 지우는 것이 좋다.

Next.js standalone 결과물에는 `public/`이 들어가지 않으므로 Dockerfile이 따로 복사한다. 정적 파일은 `public/`에 두면 이미지에 함께 들어간다.

---

## 3. 첫 배포 순서

서버에 저장소를 받은 뒤 저장소 폴더에서 실행한다.

1. **환경 파일**: `.env.example`을 `.env`로 복사하고 1장의 "운영 필수" 값을 채운다. `chmod 600 .env`.
   - 실제 운영(R3 이후): `FAKE_DATA_ALLOWED`, `SEED_STAFF_PASSWORD`를 지운다.
   - 프로토타입(R1~R2): 가짜 데이터만 쓰므로 `FAKE_DATA_ALLOWED=true`와 `SEED_STAFF_PASSWORD`를 둘 수 있다.
2. **빌드**:
   ```bash
   docker-compose -f docker-compose.prod.yml build
   ```
3. **DB와 마이그레이션**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d db
   docker-compose -f docker-compose.prod.yml run --rm migrate          # prisma migrate deploy
   ```
   `up`을 할 때마다 `migrate` 서비스가 앱보다 먼저 한 번 돌아 새 마이그레이션을 적용한다(이미 적용된 것은 건너뜀). 실패하면 앱이 뜨지 않는다.
4. **시드** (병원 설정 기본값):
   ```bash
   docker-compose -f docker-compose.prod.yml run --rm migrate prisma db seed
   ```
   `FAKE_DATA_ALLOWED`가 없으면 테스트 계정을 만들지 않고 병원 설정만 넣는다. 실제 운영에서는 이렇게 실행하고, 관리자 계정은 따로 만든다.
5. **시작**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   docker-compose -f docker-compose.prod.yml ps        # app이 Up (healthy)인지 확인
   ```
6. **HTTPS**: 앱은 `127.0.0.1:${APP_PORT}`에만 열린다. 같은 서버의 리버스 프록시(Caddy 등)가 HTTPS를 맡아 이 포트로 넘긴다. 프록시 설정은 이 문서 범위 밖이다(T10-4). 프록시를 두면 `.env`에 `TRUSTED_PROXY_HOPS=1`. `NODE_ENV=production`에서는 세션 쿠키가 `Secure`라 HTTP로는 로그인 상태가 유지되지 않는다.

업데이트는 `git pull` 후 2번과 5번(`build`, `up -d`)만 다시 하면 된다.

### 컨테이너 보안 설정 (`docker-compose.prod.yml`)

- `app`: root가 아닌 `node`(uid 1000)로 실행, `read_only: true`(쓰기 가능한 곳은 tmpfs인 `/tmp`, `/app/.next/cache`뿐), `cap_drop: ALL`, `no-new-privileges`, `restart: unless-stopped`, 포트는 127.0.0.1에만.
- `migrate`: `node` 사용자, `read_only`, `cap_drop: ALL`, `no-new-privileges`. 한 번 실행하고 끝난다.
- `db`: 포트를 밖으로 열지 않는다. 데이터는 이름 있는 볼륨 `pgdata`. postgres 공식 이미지는 시작할 때 권한을 바꾸는 과정이 있어 `cap_drop`은 두지 않았다.

### 주의

- 이 개발 서버처럼 개발용 `docker-compose.yml`도 쓰는 곳에서는 `COMPOSE_PROJECT_NAME`을 다르게 하거나 `-p 다른이름`을 준다. 같은 이름이면 두 구성이 한 프로젝트로 묶여 `down`이 개발 DB 컨테이너까지 지울 수 있다.
- `docker-compose v1.29.2`와 `docker compose v2` 둘 다에서 동작하는 키만 썼다(`depends_on`의 `condition: service_completed_successfully`는 v1.29부터 지원).
- `docker-compose -f docker-compose.prod.yml down -v`는 DB 볼륨까지 지운다. 운영에서는 `-v`를 쓰지 않는다.

---

## 4. 헬스체크

`GET /api/health` — 로그인 없이 부를 수 있다. 감사 로그를 남기지 않는다(환자 정보 없음).

| 상황 | 응답 |
| --- | --- |
| DB에 `SELECT 1` 성공 | `200 {"status":"ok","db":"ok"}` |
| DB 접속 실패 | `503 {"status":"error","db":"error"}` (서버 로그에 `health.db_unreachable`과 에러 이름·코드만) |

버전·환경 정보는 응답에 넣지 않는다. 이미지의 `HEALTHCHECK`가 30초마다 컨테이너 안에서 `node healthcheck.mjs`로 이 API를 부른다(slim 이미지에는 curl이 없다). 서버에서 직접 확인:

```bash
curl -s http://127.0.0.1:3100/api/health
docker inspect -f '{{.State.Health.Status}}' <app 컨테이너 이름>
```

---

## 5. R1 프로토타입 서버 규칙

- **가짜 데이터만** 쓴다. 실제 환자 데이터는 R3 보안 게이트를 통과하기 전에는 어떤 환경에도 넣지 않는다. 테스트 계정·가짜 데이터는 `FAKE_DATA_ALLOWED=true`인 프로토타입 서버에서만 만든다.
- **로그인과 IP 제한**으로 접속을 막는다. 앱은 로그인 없이는 화면·API를 열지 않는다. 그 앞에서 서버 방화벽 또는 리버스 프록시가 허용한 IP(병원·개발자)만 들여보낸다. 앱 포트는 127.0.0.1에만 열려 있으므로 바깥에서 바로 접속할 수 없다.
- 비밀값은 서버의 `.env`에만 둔다. 저장소·이미지·이 문서에 적지 않는다.
- 로그에는 이름·전화번호 원문이 남지 않는다(앱 로그는 ID·코드·숫자만).

---

## 6. AWS 프로토타입 서버 (R1~R2)

Task.md는 R1~R2 프로토타입을 "AWS가 아닌 외부 서버"에 두도록 적었지만, 직원 피드백을 받기 전에 AWS 서울 리전에서 미리 확인하기로 해(2026-11-12 결정) 같은 Compose 구성을 EC2 한 대에 올렸다. R3의 본 구성(Terraform, RDS, WireGuard, 변경 불가 백업 — T10-2~T10-6)은 아니며, R3에서 새로 만든다. 가짜 데이터만 쓴다.

| 항목 | 값 |
| --- | --- |
| 리전·서버 | ap-northeast-2, EC2 t4g.small(arm64) `crm-proto`, Ubuntu 24.04, 디스크 30GB gp3 암호화, IMDSv2만 |
| 주소 | 고정 IP(Elastic IP) + Route 53 `crm-gbc.com` A 레코드 |
| 접속 제한 | 보안 그룹 `crm-proto-web`: 80·443만 병원·관리자 IP(/32)에 허용. 22(SSH)는 열지 않고 SSM으로만 관리 |
| 서버 역할 | `crm-proto-ec2`: `AmazonSSMManagedInstanceCore` + 이 도메인의 Route 53 레코드 수정(인증서 DNS 인증용, `infra/prototype/instance-role-dns-policy.json`) |
| HTTPS | Caddy(Route 53 DNS 인증 모듈 포함)가 Let's Encrypt 인증서를 받아 `127.0.0.1:3100`(앱)으로 넘긴다. `infra/prototype/` |
| 코드 | 서버가 GitHub 저장소를 읽기 전용 배포 키(서버 안에서 만든 키, 저장소 Deploy keys에 등록)로 받는다. `/opt/crm/app` |
| 비밀값 | 서버의 `/opt/crm/app/.env`(root, 600)에서만 만들었다. 이 PC·저장소에 없다 |
| 관리자 PC 접근 키 | IAM 사용자 `crm-deployer`(정책 `infra/prototype/iam-policy.json`), 키는 저장소의 `.secrets/aws/`(git·Docker 제외) |

### 관리 명령 (관리자 PC, 저장소 폴더에서)

```bash
infra/prototype/ssm-run.sh 'cd /opt/crm/app && docker compose -f docker-compose.prod.yml ps'
```

### 업데이트

```bash
infra/prototype/ssm-run.sh 'cd /opt/crm/app && HOME=/root git pull -q && docker compose -f docker-compose.prod.yml up -d --build' 3000
```

### 테스트 계정 비밀번호

직원은 로그인 후 상단 [비밀번호 변경]에서 자기 비밀번호를 바꾼다(F-1). 시드(`prisma db seed`)를 다시 실행하면 테스트 계정 5개의 비밀번호가 서버 `.env`의 `SEED_STAFF_PASSWORD`로 되돌아가므로, 업데이트할 때는 시드를 다시 돌리지 않는다.

### 접속 허용 IP 추가·삭제

```bash
export AWS_SHARED_CREDENTIALS_FILE=$PWD/.secrets/aws/credentials AWS_CONFIG_FILE=$PWD/.secrets/aws/config AWS_PROFILE=crm
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=crm-proto-web --query 'SecurityGroups[0].GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id $SG --ip-permissions 'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=<IP>/32,Description=<설명>}]'
aws ec2 revoke-security-group-ingress --group-id $SG --ip-permissions 'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=<IP>/32}]'
```

### 비용을 멈출 때

서버 중지(`aws ec2 stop-instances`)는 디스크·고정 IP 요금만 남는다. 피드백이 끝나 완전히 지울 때는 서버 종료 → 고정 IP 해제 → 보안 그룹·역할 삭제 → DNS 레코드 삭제 순서로 한다(R3 본 구성으로 옮긴 뒤).

---

## 7. 이 개발 서버에서 확인한 것 (T10-1)

- amd64로 `docker build` 성공, 앱 이미지 약 301MB, migrate 이미지 약 1.52GB.
- 개발 DB에 붙여 `--read-only --cap-drop ALL --security-opt no-new-privileges`로 실행 → `/api/health` 200 ok, `docker exec … id -u` = `1000`, 프로세스 uid 1000, Docker 헬스 상태 `healthy`, `/app`에 `.env` 없음, `/app` 쓰기 불가.
- 접속할 수 없는 DB 주소로 실행 → `/api/health` 503.
- 별도 프로젝트 이름과 임시 `.env`(무작위 값)로 `docker-compose.prod.yml` 전체를 띄움 → migrate 성공(Exit 0), app `Up (healthy)`, 시드 후 테스트 계정 로그인 200(`Secure` 쿠키). 확인 후 `down -v`로 지움.
- arm64 빌드는 실행하지 않았다(buildx·QEMU 없음).
