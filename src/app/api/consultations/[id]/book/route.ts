import { z } from "zod";
import { APPOINTMENT_CHANNELS } from "@/lib/domain/appointment";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";
import { defineRoute } from "@/server/api/define-route";
import { isOnSlotBoundary } from "@/server/appointments/create";
import { bookSurgery } from "@/server/consult/service";

/** 상담 → 수술예약 (F-10, T6-2): 고가 항목 예약을 만들고 이 상담에 연결한다. 상담자 = 예약의 상담자. */
export const POST = defineRoute({
  permission: "consult.write",
  audit: "CONSULT_BOOK",
  params: z.object({ id: z.uuid() }),
  body: z.strictObject({
    startAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)).refine(isOnSlotBoundary, { message: "slot" }),
    durationMin: z.number().int(),
    chair: z.string().min(1).max(20),
    treatmentItem: z.string().min(1).max(50),
    doctorId: z.uuid().nullish(),
    channel: z.enum(APPOINTMENT_CHANNELS).exclude(["WALK_IN"]).default("ONSITE"),
    memo: z.string().max(1000).nullish().refine((v) => v == null || !containsResidentRegistrationNumber(v), { message: RRN_FIELD_CODE }),
  }),
  handler: async (ctx) => {
    const result = await bookSurgery(ctx.db, ctx.params.id, ctx.body, { actorId: ctx.staff.id, inputDevice: ctx.inputDevice, now: ctx.now });
    ctx.touchPatients([result.patientId]);
    ctx.audit({ consultationId: ctx.params.id, appointmentId: result.appointmentId });
    return Response.json({ appointmentId: result.appointmentId }, { status: 201 });
  },
});
