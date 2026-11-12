import { z } from "zod";
import { isHexColor } from "@/lib/calendar/colors";
import { PRICE_MAX, TREATMENT_CATEGORIES } from "@/lib/domain/treatment";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";
import { defineRoute } from "@/server/api/define-route";
import { saveTreatmentItems } from "@/server/appointments/treatment-items";

/**
 * 예약 항목 목록·구분·단가 저장 — F-5·F-6, 관리자([편집] 탭). 읽기는 GET /api/settings(treatmentItems, treatmentItemMeta).
 * 이미 있는 예약은 저장된 항목 이름·단가를 그대로 둔다(이름을 바꾸면 지난 예약은 옛 이름으로 남는다).
 */
const body = z.strictObject({
  items: z
    .array(
      z.strictObject({
        name: z
          .string()
          .trim()
          .min(1)
          .max(30)
          .refine((value) => !containsResidentRegistrationNumber(value), { message: RRN_FIELD_CODE }),
        category: z.enum(TREATMENT_CATEGORIES),
        price: z.number().int().min(0).max(PRICE_MAX),
        /** 캘린더 칸 색 (F-9) */
        color: z.string().refine(isHexColor, { message: "color" }).optional(),
      }),
    )
    .min(1)
    .max(60),
});

export const PUT = defineRoute({
  permission: "settings.write",
  audit: "TREATMENT_ITEMS_UPDATE",
  body,
  handler: async (ctx) => {
    const saved = await saveTreatmentItems(ctx.db, ctx.body.items, ctx.staff.id);
    ctx.audit({ itemCount: ctx.body.items.length });
    return saved;
  },
});
