# 치과 CRM — 작업 규칙

@AGENTS.md

## 절대 규칙

1. 실제 환자 데이터를 개발 환경·테스트·프롬프트에 절대 넣지 않는다. 가짜 데이터 생성 스크립트(T0-5)만 쓴다.
2. 비밀번호·API 키·DB 접속 정보를 코드나 저장소에 쓰지 않는다. 환경변수와 AWS Secrets Manager만 쓴다.
3. 주민등록번호와 진료기록(진단·처방)을 저장하는 필드를 만들지 않는다.
4. 환자 정보를 조회·수정·내보내는 모든 API는 권한 검사와 감사 로그 기록을 거친다. 예외 없음.
5. visit_status_log와 감사 로그는 추가만 가능하다. 수정·삭제 코드를 만들지 않는다.
6. 로그·에러 메시지에 이름·전화번호 원문을 남기지 않는다.
7. 모든 데이터들은 ~/crm_plan/ 하위에 작성한다.
8. 디렉토리 관리를 깔끔하게 하여 한번에 코드를 옮길 수 있도록 한다.

## 문서

| 파일 | 내용 |
| --- | --- |
| `docs/Proposal.md` | 기획서. 4-1(예약 상태값), 4-3(입력 규칙), 6장(데이터 모델), 10장(보안 설계)이 구현 기준 |
| `docs/TASKS.md` | Task 목록, 완료 기준, 라운드(R1~R4) 순서 |
| `docs/CHECKLIST.md` | 진행 현황 (✅ 완료 / 🔄 진행중 / ⬜ 미완) |
| `docs/FEEDBACK.md` | 직원 피드백 기록 (R2부터 작성) |

## 작업 방식

- Task는 `docs/TASKS.md`의 라운드 순서대로, 한 번에 하나씩 진행한다.
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
│   ├── components/     화면 컴포넌트 (ui/ 는 shadcn 기본 컴포넌트)
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
