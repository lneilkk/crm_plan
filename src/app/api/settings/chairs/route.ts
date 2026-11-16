import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { saveChairs } from "@/server/settings/clinic-settings";

/** 체어·열 묶음 저장 — F-14(T4-4), 관리자. 화면 순서 그대로가 캘린더 열 순서다. */
export const PUT = defineRoute({
  permission: "settings.write",
  audit: "SETTINGS_CHAIRS_UPDATE",
  body: z.strictObject({
    chairs: z
      .array(
        z.strictObject({
          code: z.string().trim().regex(/^[A-Za-z0-9가-힣_-]{1,10}$/),
          name: z.string().trim().min(1).max(20),
          kind: z.enum(["CHAIR", "CONSULT_ROOM"]),
          group: z.string().trim().max(20).optional(),
        }),
      )
      .min(1)
      .max(40),
  }),
  handler: async (ctx) => {
    const result = await saveChairs(ctx.db, ctx.body.chairs, ctx.staff.id, ctx.now);
    ctx.audit({ chairCount: ctx.body.chairs.length, removed: result.removed });
    return { ok: true };
  },
});
