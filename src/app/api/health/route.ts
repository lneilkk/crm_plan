import { defineRoute } from "@/server/api/define-route";
import { db } from "@/server/db";
import { errorFields, log } from "@/server/log";

/**
 * 헬스체크 (T10-1). Docker HEALTHCHECK와 운영 점검이 부른다. 세션 없이 열린다(routes.test.ts의 PUBLIC_ROUTES).
 *
 * DB에 SELECT 1을 보내 접속을 확인한다. 실패하면 503.
 * 버전·환경 정보는 응답에 넣지 않는다(외부에 서버 정보를 알려 주지 않기 위해).
 * 환자 정보를 다루지 않아 감사 행은 없다.
 */
export const GET = defineRoute({
  permission: "public",
  audit: "none",
  handler: async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: "ok", db: "ok" };
    } catch (error) {
      // 에러 메시지에는 접속 주소가 섞일 수 있어 이름·코드만 남긴다.
      log.warn("health.db_unreachable", errorFields(error));
      return Response.json({ status: "error", db: "error" }, { status: 503 });
    }
  },
});
