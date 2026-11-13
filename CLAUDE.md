# 치과 CRM — 작업 규칙

@AGENTS.md

## 절대 규칙

원본은 `docs/CLAUDE.md`다. 규칙을 고칠 때는 그 파일만 고친다 (아래 줄이 그 파일을 그대로 불러온다).
작업을 시작하기 전에 `docs/CLAUDE.md`를 반드시 읽는다.

@docs/CLAUDE.md

## 문서

| 파일 | 내용 |
| --- | --- |
| `docs/CLAUDE.md` | 절대 규칙 원본 (사용자가 직접 관리) |
| `docs/Proposal.md` | 기획서. 4-1(예약 상태값), 4-3(입력 규칙), 6장(데이터 모델), 10장(보안 설계)이 구현 기준 |
| `docs/Task.md` | Task 목록, 완료 기준, 라운드(R1~R4) 순서 (사용자가 직접 관리) |
| `docs/CHECKLIST.md` | 진행 현황 (✅ 완료 / 🔄 진행중 / ⬜ 미완) |
| `docs/FEEDBACK.md` | 직원 피드백 기록 (R2부터 작성) |
| `docs/REPORT.md` | 개발 현황 보고서 (진행 현황, 기능, 보안, 남은 일) |
| `docs/EXPANSION.md` | 확장 계획 (화면·권한 구조 정리 S, 메시지 발송 M, 외부 예약 B, EMR 판단). S Task 진행 순서의 기준 |
| `docs/SCREEN_MAP.md` | 화면·메뉴·버튼과 API별 필요 권한 지도 (S-1) |

## 작업 방식

- Task는 `docs/Task.md`의 라운드 순서대로, 한 번에 하나씩 진행한다.
- 시작할 때 `docs/CHECKLIST.md`에서 해당 Task를 🔄 진행중으로 바꾼다. 완료 기준을 테스트나 실행으로 확인한 뒤에만 ✅ 완료로 바꾸고, 무엇으로 확인했는지 검증 메모에 적는다. 확인하지 못한 기준이 남으면 진행중으로 두고 남은 것을 적는다.
- 완료 기준을 통과하면 Task 단위로 커밋한다. 커밋 메시지는 `T4-2: 예약 캘린더 화면`처럼 Task ID로 시작한다.
- 권한·상태 전환·암호화처럼 틀리면 사고가 되는 로직은 테스트를 먼저 쓴다.
- 기획서와 다르게 구현해야 할 때는 임의로 정하지 말고, 차이와 이유를 CHECKLIST.md 검증 메모에 남긴다.

## 명령어

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (http://localhost:3100, 이 PC에서만 접속 가능하게 127.0.0.1에 묶음) |
| `npm run lint` | ESLint |
| `npm run typecheck` | 라우트 타입 생성 후 TypeScript 검사 |
| `npm test` | 단위 테스트 (Vitest) |
| `npm run check` | lint + typecheck + 단위 테스트를 한 번에 |
| `npm run db:up` | 로컬 PostgreSQL 띄우기 (Docker Compose, 127.0.0.1:54329). `.env`가 없으면 만들고 준비될 때까지 기다림 |
| `npm run db:down` | 로컬 DB 컨테이너 내리기. 데이터(`.data/postgres`)는 남음 |
| `npm run db:check` | `.env`의 `DATABASE_URL`로 접속해 서버 버전 출력 (성공 0, 실패 1) |
| `npm run db:psql` | DB 컨테이너 안에서 psql 열기. 인자는 `--` 뒤에 붙임 (예: `npm run db:psql -- -c "select 1"`) |
| `npm run setup:env` | `.env.example`로 `.env` 생성(비밀값 무작위, 권한 600). 이미 있으면 바꾸지 않고 빠진 변수 이름만 알려 줌 |
| `npm run db:generate` | Prisma 클라이언트 생성(`src/generated/prisma`). DB·`DATABASE_URL` 없이 동작하며 `npm install` 뒤에 자동 실행됨 |
| `npm run db:migrate` | 스키마 변경으로 새 마이그레이션을 만들고 개발 DB에 적용(`prisma migrate dev`). 끝나면 `db:generate`를 따로 실행 |
| `npm run db:deploy` | 아직 적용하지 않은 마이그레이션만 적용(`prisma migrate deploy`, CI·운영용) |
| `npm run db:reset` | 개발 DB를 비우고 마이그레이션을 처음부터 다시 적용(데이터 모두 삭제, 개발자 전용) |
| `npm run db:seed` | 시드(`prisma/seed.ts`): 병원 기본 설정(없을 때만)과 역할별 테스트 계정(`FAKE_DATA_ALLOWED=true`일 때만, 비밀번호는 `.env`의 `SEED_STAFF_PASSWORD`). 다시 실행해도 중복 없이 계정 비밀번호·잠금만 초기화 |
| `npm run fake:data` | 가짜 환자 500명과 약 3개월분 예약·내원 이력을 DB에 넣음(`FAKE_DATA_ALLOWED=true`일 때만, 시드 계정 필요). 실행마다 새 seed. 옵션은 `--` 뒤에: `--seed <n>`·`--now <ISO 시각>`(재현), `--patients <n>`, `--append`(환자가 있어도 더 넣기). 출력은 건수와 seed뿐 |
| `npm run db:fresh` | 개발 DB를 처음부터: `db:reset` → `db:seed` → `fake:data`. 개발 DB의 데이터가 모두 지워짐(개발자 전용) |
| `npm run test:integration` | DB 통합 테스트(`tests/integration/`). 실행마다 임시 DB `crm_test_*`를 만들고 끝나면 지움. 개발 DB는 건드리지 않음 |
| `npm run test:e2e` | 브라우저 시나리오 테스트(`tests/e2e/`, Playwright). 별도 DB `crm_e2e`를 새로 만들고 개발 서버를 127.0.0.1:3105에 띄움. 실행 중에는 이 폴더에서 `npm run dev`를 같이 돌리지 않음 |
| `npm run staff:unlock -- <아이디>` | 운영자용 계정 잠금 해제(관리자까지 모두 잠겨 화면에서 풀 수 없을 때). 해제와 감사 로그를 한 트랜잭션에 기록 |
| `npm run db:test:clean` | 비정상 종료로 남은 `crm_test_*` DB 삭제(실행 중인 테스트의 DB는 남김) |

## 폴더 구조

```
crm_plan/
├── CLAUDE.md · AGENTS.md · README.md
├── docs/               기획서, Task 목록, 체크리스트
├── prisma/             schema.prisma, migrations/, seed
├── src/
│   ├── app/            화면과 API (Next.js App Router)
│   │   ├── (auth)/     로그인 등 로그인 전 화면
│   │   ├── (app)/      로그인 후 화면 (내원 보드, 캘린더, 고객, 통계)
│   │   └── api/        API — route.ts만 사용
│   ├── components/     화면 컴포넌트 (ui/ 는 직접 만든 Tailwind 기본 컴포넌트, 사용법은 ui/index.ts)
│   ├── lib/            서버·브라우저 공용 순수 로직 (상태 전환, 통계 산식, 마스킹, 시간)
│   ├── server/         서버 전용 코드 (DB, 인증, 암호화, 감사 로그, API 공통 계층, 서비스)
│   └── generated/      Prisma 클라이언트 (자동 생성, git 제외)
├── scripts/            가짜 데이터 생성 등 개발·운영 스크립트
├── tests/              integration/ (DB 필요), e2e/ (Playwright)
└── .github/workflows/  CI
```

- 단위 테스트는 소스 파일 옆에 `*.test.ts`로 둔다. DB가 필요한 테스트는 `tests/integration/`, 화면 시나리오는 `tests/e2e/`.
- 임시 파일은 `.tmp/`(git 제외)에만 만들고 끝나면 지운다. 저장소 밖에는 쓰지 않는다.

## 구현 규칙

- **Next.js 16**: 코드를 쓰기 전에 `node_modules/next/dist/docs/`에서 해당 가이드를 읽는다. Cache Components가 켜져 있어 `cookies()`·`headers()`는 `<Suspense>` 안에서만 읽을 수 있고, middleware는 `src/proxy.ts`다.
- **캐시 금지**: 환자 데이터는 요청마다 새로 읽는다. `'use cache'` 지시어를 쓰지 않는다.
- **API는 route.ts만**: 데이터 조회·변경은 `src/app/api/**/route.ts`로만 만든다. Server Action(`'use server'`)은 쓰지 않는다. 권한 검사와 감사 로그를 한 곳에서 강제하기 위해서다.
- **시간**: 날짜 경계·요일·'당일' 판정은 항상 한국 시간(Asia/Seoul, UTC+9, 서머타임 없음) 기준이다. DB에는 UTC(timestamptz)로 저장하고 `src/lib/time/kst.ts`의 함수만 쓴다. 서버 로컬 시간대에 의존하는 `getDate()`·`getHours()`·`toLocaleDateString()` 등을 직접 쓰지 않는다.
- **로그**: `console.*`를 직접 쓰지 않고 `src/server/log.ts`의 `log`를 쓴다. 로그에는 ID와 코드만 넣고 이름·전화번호·생년월일·메모 내용은 넣지 않는다.
- **DB**: 테이블·컬럼은 snake_case(`@map`), 기본 키는 UUID v7. 스키마는 기획서 6장을 따른다.
- **의존성**: `prisma`와 `@prisma/client`는 7.10.1로 고정한다(npm의 latest 태그가 8.0 RC를 가리킨다). 새 의존성은 꼭 필요할 때만 추가한다.
- **문구**: 화면 문구와 문서는 한국어, 코드 식별자는 영어, 주석은 한국어.
