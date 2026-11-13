# 치과 CRM

예약 → 내원 확인 → 통계를 한 곳에서 처리하는 치과(1개 지점) 전용 CRM.
Next.js(화면 + API) + PostgreSQL + Prisma로 만든 단일 애플리케이션이다.

- 기획서: [docs/Proposal.md](docs/Proposal.md)
- Task 목록과 완료 기준: [docs/Task.md](docs/Task.md)
- 진행 현황: [docs/CHECKLIST.md](docs/CHECKLIST.md)
- 작업 규칙(절대 규칙, 명령어, 폴더 구조): [CLAUDE.md](CLAUDE.md)

## 시작하기

필요한 것: Node.js 22 이상, Docker와 Docker Compose(v1 `docker-compose`, v2 `docker compose` 모두 가능).

```bash
npm install
npm run db:up    # 로컬 PostgreSQL 띄우기 (127.0.0.1:54329). 처음이면 .env도 만든다
npm run db:check # 앱이 쓰는 DATABASE_URL로 접속되는지 확인
npm run db:deploy # 마이그레이션 적용
npm run db:seed  # 병원 기본 설정과 역할별 테스트 계정 만들기
npm run fake:data # 가짜 환자 500명과 약 3개월분 예약·내원 이력 넣기
npm run dev      # http://localhost:3100
```

개발 DB를 처음 상태로 다시 만들 때는 `npm run db:fresh` 하나로 된다(`db:reset` → `db:seed` → `fake:data`, 기존 데이터는 모두 지워진다). DB를 지우기 전에 `.env`의 `FAKE_DATA_ALLOWED=true`를 먼저 확인하고, 없으면 아무것도 지우지 않고 멈춘다.

### 가짜 데이터

`npm run fake:data`가 `scripts/fake-data/`의 생성기로 만든 데이터만 넣는다. 실제 환자 데이터는 쓰지 않는다.

- 이름은 성·음절을 무작위로 조합한 것이고, 전화번호는 가입자에게 배정되지 않는 `010-0XXX-XXXX` 대역이다. 모든 환자에 `가짜데이터` 태그가 붙는다.
- 전화번호·생년월일은 앱과 같은 방식으로 암호화해 넣는다(`.env`의 `PII_ENC_KEY`·`PII_HMAC_KEY`).
- `.env`에 `FAKE_DATA_ALLOWED=true`가 있고 `npm run db:seed`로 테스트 계정을 만든 뒤에만 실행된다.
- 실행할 때마다 새 seed로 다른 데이터를 만든다. 출력에 seed와 기준 시각이 나오므로 `npm run fake:data -- --seed <n> --now <시각>`으로 같은 데이터를 다시 만들 수 있다. `--patients <n>`으로 환자 수(기본 500)를 바꾼다.
- 환자가 이미 있으면 멈춘다. 더 넣으려면 `--append`(기존 예약과 체어·시간이 겹치는 예약은 빼고 넣는다), 처음부터 다시 하려면 `npm run db:fresh`.
- 내원 상태 이력과 감사 로그는 지우지 않는 것이 규칙이라(절대 규칙 5) 가짜 데이터만 골라 지우는 명령은 없다. 다시 시작할 때는 개발 DB를 새로 만든다.

### 테스트 계정

`npm run db:seed`가 만든다. 비밀번호는 모두 `.env`의 `SEED_STAFF_PASSWORD` 값이다(`npm run db:up`이 무작위로 만든다).

| 아이디 | 부서 · 직무 | 개인 추가 권한 |
| --- | --- | --- |
| `admin` | 운영 · 관리자 | |
| `doctor1`, `doctor2` | 진료 · 의사 | 통계·실적 보기, 상담 보기 (원장처럼) |
| `front1` | 프론트 · 프론트 | |
| `counselor1` | 상담 · 상담 | |
| `nurse1` | 진료 · 간호 | |

권한은 직무별 권한(DB의 `job_permission`, 관리자가 편집)에 개인 추가 권한을 더한 것이다. 권한의 종류와 처음 설치할 때의 값은 `src/lib/auth/permissions.ts`에 있고, 첫 설치 값은 마이그레이션이 한 번만 넣는다(시드는 덮어쓰지 않음).

- 계정은 `.env`에 `FAKE_DATA_ALLOWED=true`가 있을 때만 만든다. 실제 운영 환경에는 이 변수를 두지 않으므로 테스트 계정이 생기지 않는다(병원 설정만 만든다).
- 다시 실행하면 같은 아이디의 비밀번호를 현재 `SEED_STAFF_PASSWORD`로 다시 정하고, 잠금·실패 횟수를 풀고, 다시 활성화한다. 계정은 늘어나지 않는다.
- 병원 설정은 없을 때만 기본값으로 만든다. 설정 화면에서 바꾼 값은 다시 시드해도 그대로 남는다.

### 테스트

| 명령 | 설명 |
| --- | --- |
| `npm run check` | lint, 타입 검사, 단위 테스트 |
| `npm run test:integration` | DB 통합 테스트. 실행마다 임시 DB `crm_test_*`를 만들고 끝나면 지운다 |
| `npm run test:e2e` | 브라우저 시나리오 테스트(Playwright). 별도 DB `crm_e2e`를 새로 만들고 개발 서버를 127.0.0.1:3105에 띄운다. 실행 중에는 `npm run dev`를 같이 돌리지 않는다 |

- 개발 DB(`crm`)는 어떤 테스트도 건드리지 않는다. 다 쓴 `crm_e2e`는 다음 실행 때 다시 만들어지므로 남아 있어도 된다.
- 자정 앞뒤 1시간(23시~01시)과 휴진일(기본 일요일)에는 '오늘 이미 시작한 예약'이 필요한 E2E 시나리오 일부가 건너뛰어진다.

### 로컬 DB

| 명령 | 설명 |
| --- | --- |
| `npm run db:up` | `.env`가 없으면 만들고, DB 컨테이너를 띄운 뒤 준비될 때까지 기다린다. 설정을 바꾼 뒤에도 이 명령 하나로 다시 띄운다 |
| `npm run db:down` | 컨테이너를 내린다. 데이터는 `.data/postgres`에 남는다 |
| `npm run db:check` | `.env`의 `DATABASE_URL`로 접속해 서버 버전을 출력한다 |
| `npm run db:psql` | 컨테이너 안에서 psql을 연다 (`npm run db:psql -- -c "select 1"`처럼 인자를 넘길 수 있다) |
| `npm run setup:env` | `.env`만 만든다. 이미 있으면 바꾸지 않고 빠진 변수 이름만 알려 준다 |

- 환경변수 목록과 설명은 [.env.example](.env.example)에 있다. 실제 값이 든 `.env`는 git에 올리지 않는다. DB 비밀번호와 암호화 키는 `npm run db:up`(또는 `setup:env`)이 무작위로 만들어 `.env`에만 쓴다.
- DB는 이 PC(127.0.0.1)에서만 접속할 수 있다. 데이터 파일은 저장소 안의 `.data/postgres`(git 제외)에 개발자 계정 소유로 저장된다.
- DB를 처음 상태로 되돌리려면 `npm run db:down` 후 `.data/postgres` 폴더를 지우고 `npm run db:up`을 다시 실행한다.
- `.env`나 `docker-compose.yml`을 바꾼 뒤에는 `npm run db:up`을 다시 실행한다. docker-compose v1은 설정이 바뀐 컨테이너를 다시 만들지 못하므로, `db:up`이 컨테이너를 지우고 새로 만든다(데이터는 남는다).
- `DATABASE_URL`은 `.env`를 처음 만들 때 한 번만 조립된다. `.env`의 `POSTGRES_PORT`·`POSTGRES_PASSWORD`·`POSTGRES_USER`·`POSTGRES_DB`를 바꾸면 `DATABASE_URL`도 직접 같이 고쳐야 `npm run db:check`와 앱이 접속된다. 비밀번호·계정·DB 이름은 DB를 처음 만들 때만 적용되므로 `.data/postgres`도 지워야 한다.
- `.env.example`에 변수가 새로 생기면 `db:up`과 `setup:env`가 빠진 변수 이름을 알려 준다. 기존 `.env`는 자동으로 바뀌지 않으므로 직접 추가한다.
- 처음 띄울 때 `docker-compose up`을 직접 실행하지 않는다. `.data/postgres` 폴더가 없으면 Docker가 root 소유로 만들어 DB가 뜨지 않는다.

실제 환자 데이터는 R3(보안 게이트)를 통과하기 전까지 어떤 환경에도 넣지 않는다. 개발·프로토타입은 가짜 데이터만 쓴다.
