import { z } from "zod";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { appointmentForViewer } from "@/server/appointments/price";
import { registerWalkIn } from "@/server/appointments/walk-in";

/**
 * 워크인 등록 — T5-5. 예약 없이 온 고객을 지금 시각 예약(채널 '워크인')으로 만들고 바로 내원 처리한다.
 * 예약을 만들고(appointment.write) 내원 상태를 바꾸는(visit.write) 일이라 두 권한이 모두 있어야 한다.
 * 시각은 서버가 정한다(지금, 5분 단위로 내림). 감사 행에는 예약 id와 고객 id만.
 */
export const POST = defineRoute({
  permission: "appointment.write",
  audit: "WALK_IN_REGISTER",
  body: z.strictObject({
    patientId: z.uuid(),
    chair: z.string().min(1).max(20),
    treatmentItem: z.string().min(1).max(50),
    durationMin: z.number().int(),
    doctorId: z.uuid().nullish(),
    counselorId: z.uuid().nullish(),
    memo: z
      .string()
      .max(1000)
      .nullish()
      .refine((value) => value == null || !containsResidentRegistrationNumber(value), { message: RRN_FIELD_CODE }),
  }),
  handler: async (ctx) => {
    ctx.touchPatients([ctx.body.patientId]);
    if (!ctx.staff.permissions.includes("visit.write")) {
      throw new ApiError(403, "FORBIDDEN", "내원 상태를 바꿀 권한이 없습니다.");
    }
    const result = await registerWalkIn(ctx.db, ctx.body, { actor: ctx.staff, now: ctx.now, inputDevice: ctx.inputDevice });
    ctx.audit({ appointmentId: result.appointment.id });
    return Response.json({ appointment: appointmentForViewer(ctx.staff, result.appointment), isLate: result.isLate }, { status: 201 });
  },
});
