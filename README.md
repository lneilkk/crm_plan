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
npm run dev      # http://localhost:3100
```

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
