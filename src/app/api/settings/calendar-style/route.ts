import { z } from "zod";
import { APPOINTMENT_STATUSES } from "@/lib/domain/appointment";
import { isHexColor, LABEL_NAME_MAX, MAX_LABELS, STATUS_NAME_MAX } from "@/lib/calendar/colors";
import { containsResidentRegistrationNumber, RRN_FIELD_CODE } from "@/lib/validation/forbidden-text";
import { defineRoute } from "@/server/api/define-route";
import { getCalendarStyle, saveCalendarStyle } from "@/server/appointments/labels";

/**
 * 예약 캘린더 색 설정 — F-2. 라벨 목록과 예약 상태별 표시 이름·색.
 * 읽기는 모든 직원(캘린더 칸 색·범례), 저장은 관리자([편집] 탭). 환자 정보가 없어 읽기는 감사 행이 없다.
 */
export const GET = defineRoute({
  permission: "settings.read",
  audit: "none",
  handler: () => getCalendarStyle(),
});

const color = z.string().refine(isHexColor, { message: "color" });
const name = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !containsResidentRegistrationNumber(value), { message: RRN_FIELD_CODE });

const statusStyle = z.object({ name: name(STATUS_NAME_MAX), color });

const body = z.strictObject({
  labels: z
    .array(z.strictObject({ id: z.uuid().optional(), name: name(LABEL_NAME_MAX), color, isActive: z.boolean() }))
    .max(MAX_LABELS),
  statusStyles: z.strictObject(
    Object.fromEntries(APPOINTMENT_STATUSES.map((status) => [status, statusStyle])) as Record<
      (typeof APPOINTMENT_STATUSES)[number],
      typeof statusStyle
    >,
  ),
});

export const PUT = defineRoute({
  permission: "settings.write",
  audit: "CALENDAR_STYLE_UPDATE",
  body,
  handler: async (ctx) => {
    const result = await saveCalendarStyle(ctx.db, ctx.body, ctx.staff.id);
    ctx.audit({ labelCount: ctx.body.labels.length, ...result });
    return getCalendarStyle(ctx.db);
  },
});
