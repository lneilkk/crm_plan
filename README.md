# 치과 CRM

예약 → 내원 확인 → 통계를 한 곳에서 처리하는 치과(1개 지점) 전용 CRM.
Next.js(화면 + API) + PostgreSQL + Prisma로 만든 단일 애플리케이션이다.

- 기획서: [docs/Proposal.md](docs/Proposal.md)
- Task 목록과 완료 기준: [docs/Task.md](docs/Task.md)
- 진행 현황: [docs/CHECKLIST.md](docs/CHECKLIST.md)
- 작업 규칙(절대 규칙, 명령어, 폴더 구조): [CLAUDE.md](CLAUDE.md)

## 시작하기

```bash
npm install
npm run dev      # http://localhost:3100
```

실제 환자 데이터는 R3(보안 게이트)를 통과하기 전까지 어떤 환경에도 넣지 않는다. 개발·프로토타입은 가짜 데이터만 쓴다.
