import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { isValidDiscountRate } from "@/lib/domain/treatment";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";
import { getAppointmentDetail } from "@/server/appointments/query";
import { updateAppointment } from "@/server/appointments/update";

/** 예약 한 건 상세와 상태 이력 — T4-1 */
export const GET = defineRoute({
  permission: "appointment.read",
  audit: "APPOINTMENT_READ",
  params: z.object({ id: z.uuid() }),
  handler: async (ctx) => {
    const appointment = await getAppointmentDetail(ctx.params.id);
    ctx.touchPatients([appointment.patientId]);
    ctx.audit({ appointmentId: appointment.id });
    return { appointment };
  },
});

/**
 * 예약 고치기 — F-5(항목·체어), F-6(할인율), F-8(메모). 보낸 필드만 바꾼다. 상태는 바꾸지 않는다.
 * 감사 행에는 바꾼 필드 이름만 남긴다(메모 내용은 남기지 않는다).
 */
const updateBody = z
  .strictObject({
    treatmentItem: z.string().min(1).max(50).optional(),
    chair: z.string().min(1).max(20).optional(),
    doctorId: z.uuid().nullable().optional(),
    counselorId: z.uuid().nullable().optional(),
    memo: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .transform((value) => (typeof value === "string" ? value.trim() || null : value))
      .refine((value) => value == null || !containsResidentRegistrationNumber(value), { message: RRN_FIELD_CODE }),
    discountRate: z.number().refine(isValidDiscountRate, { message: "discount" }).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: "empty" });

export const PATCH = defineRoute({
  permission: "appointment.write",
  audit: "APPOINTMENT_UPDATE",
  params: z.object({ id: z.uuid() }),
  body: updateBody,
  handler: async (ctx) => {
    ctx.audit({ appointmentId: ctx.params.id });
    const { before, after, fields } = await updateAppointment(ctx.db, ctx.params.id, ctx.body, ctx.now);
    ctx.touchPatients([before.patientId]);
    ctx.audit({ fields: fields.join(","), ...(before.chair !== after.chair ? { fromChair: before.chair, toChair: after.chair } : {}) });
    return { ok: true };
  },
});
