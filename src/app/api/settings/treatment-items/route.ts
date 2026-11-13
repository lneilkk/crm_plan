import { z } from "zod";
import { isHexColor } from "@/lib/calendar/colors";
import { PRICE_MAX, TREATMENT_CATEGORIES } from "@/lib/domain/treatment";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";
import { defineRoute } from "@/server/api/define-route";
import { saveTreatmentItems } from "@/server/appointments/treatment-items";
import { assertCanChangePrice, treatmentMetaForViewer } from "@/server/appointments/price";

/**
 * 예약 항목 목록·구분·단가 저장 — F-5·F-6, 관리자([편집] 탭). 읽기는 GET /api/settings(treatmentItems, treatmentItemMeta).
 * 이미 있는 예약은 저장된 항목 이름·단가를 그대로 둔다(이름을 바꾸면 지난 예약은 옛 이름으로 남는다).
 * 단가(price)는 금액 권한(appointment.price)이 있어야 보낼 수 있다(S-3). 보내지 않으면 같은 이름 항목의 기존 단가를 유지하고, 새 항목은 "단가 미입력"(null, 0원과 다름).
 * 단가를 채우면 그 항목으로 단가 없이 잡힌 예약(list_price null)에도 채운다.
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
        /** null = 단가 미입력. 보내지 않으면(undefined) 기존 단가 유지, 새 항목은 미입력 */
        price: z.number().int().min(0).max(PRICE_MAX).nullable().optional(),
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
    if (ctx.body.items.some((item) => item.price !== undefined)) assertCanChangePrice(ctx.staff);
    const saved = await saveTreatmentItems(ctx.db, ctx.body.items, ctx.staff.id);
    ctx.audit({ itemCount: ctx.body.items.length, backfilledAppointments: saved.backfilled });
    return { treatmentItems: saved.treatmentItems, treatmentItemMeta: treatmentMetaForViewer(ctx.staff, saved.treatmentItemMeta) };
  },
});
