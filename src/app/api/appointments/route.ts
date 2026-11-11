import { z } from "zod";
import { APPOINTMENT_CHANNELS } from "@/lib/domain/appointment";
import { diffDays, isValidDateKey, kstDateKey } from "@/lib/time/kst";
import { defineRoute } from "@/server/api/define-route";
import { ApiError } from "@/server/api/errors";
import { createAppointment, isOnSlotBoundary } from "@/server/appointments/create";
import { listAppointments, MAX_RANGE_DAYS } from "@/server/appointments/query";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";

/** 예약 API — T4-1. 생성(POST)과 캘린더 기간 조회(GET). */

const dateKey = z.string().refine(isValidDateKey);

/** 캘린더 조회: from~to는 한국 시간 날짜(양끝 포함), 최대 42일 */
const listQuery = z
  .object({
    from: dateKey,
    to: dateKey,
    chair: z.string().min(1).max(20).optional(),
    doctorId: z.uuid().optional(),
  })
  .refine(({ from, to }) => {
    // 날짜 자체가 틀리면 필드 검사가 이미 걸렀다(zod는 필드 실패 뒤에도 이 검사를 부른다).
    if (!isValidDateKey(from) || !isValidDateKey(to)) return true;
    const days = diffDays(from, to) + 1;
    return days >= 1 && days <= MAX_RANGE_DAYS;
  }, { path: ["to"], message: "range" });

export const GET = defineRoute({
  permission: "appointment.read",
  audit: "APPOINTMENT_LIST",
  query: listQuery,
  handler: async (ctx) => {
    const items = await listAppointments(ctx.query);
    ctx.touchPatients([...new Set(items.map((item) => item.patientId))]);
    ctx.audit({ appointmentCount: items.length });
    return { items };
  },
});

/** 워크인은 내원 보드의 워크인 등록으로만 만든다. 원 예약 id·상태·내원 시각은 받지 않는다(strict). */
const createBody = z.strictObject({
  patientId: z.uuid(),
  startAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine(isOnSlotBoundary, { message: "slot" }),
  durationMin: z.number().int(),
  doctorId: z.uuid().nullish(),
  counselorId: z.uuid().nullish(),
  chair: z.string().min(1).max(20),
  treatmentItem: z.string().min(1).max(50),
  channel: z.enum(APPOINTMENT_CHANNELS).exclude(["WALK_IN"]),
  memo: z
    .string()
    .max(1000)
    .nullish()
    .refine((value) => value == null || !containsResidentRegistrationNumber(value), { message: RRN_FIELD_CODE }),
});

export const POST = defineRoute({
  permission: "appointment.write",
  audit: "APPOINTMENT_CREATE",
  body: createBody,
  handler: async (ctx) => {
    ctx.touchPatients([ctx.body.patientId]);
    // 옮기기·예약변경과 같은 규칙: 지난 날짜(한국 시간)로는 만들지 않는다. 지난 예약을 만들어 바로 노쇼로
    // 처리하면 통계·노쇼 횟수에 소급 기록이 들어간다.
    if (kstDateKey(ctx.body.startAt) < kstDateKey(ctx.now)) {
      throw new ApiError(400, "PAST_DATE", "지난 날짜로는 예약할 수 없습니다.");
    }
    const appointment = await createAppointment(ctx.body, {
      actorId: ctx.staff.id,
      inputDevice: ctx.inputDevice,
      tx: ctx.db,
    });
    ctx.audit({ appointmentId: appointment.id, chair: appointment.chair, channel: appointment.channel });
    return Response.json({ appointment }, { status: 201 });
  },
});
