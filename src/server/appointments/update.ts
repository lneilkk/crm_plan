import "server-only";

import type { Appointment } from "@/generated/prisma/client";
import { SLOT_HOLDING_STATUSES } from "@/lib/domain/appointment";
import { treatmentMetaOf } from "@/lib/domain/treatment";
import { kstDateKey } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import type { DbClient } from "@/server/db";
import {
  assertChair,
  assertConsultRoomItem,
  assertStaffRole,
  chairConflictError,
  COUNSELOR_ROLES,
  DOCTOR_ROLES,
  invalidField,
  isChairOverlapError,
} from "./create";
import { getClinicSettings } from "./settings";

/**
 * 예약 고치기 — F-5(항목·체어), F-6(할인율), F-8(메모). 상태는 바꾸지 않는다(상태는 status·revert API만).
 *
 * - 메모·할인율: 상태·날짜와 상관없이 고칠 수 있다(지난 내원 건의 할인 입력 포함).
 * - 항목·체어·의사·상담자: 오늘 이후(한국 시간) 예약이고, 처리가 끝나 자리를 비운 상태(노쇼·취소·변경)가 아닐 때만.
 * - 항목을 바꾸면 그 시점 단가를 다시 저장한다(list_price).
 * - 상담실에는 고가 항목만(F-5): 상담실 예약을 일반 항목으로 바꾸려면 진료 체어를 함께 보내야 한다.
 *   같은 체어·겹치는 시간이면 409 CHAIR_CONFLICT(DB 제약).
 * - client는 route의 ctx.db(감사 행과 같은 트랜잭션)다.
 */

export type UpdateAppointmentInput = {
  treatmentItem?: string;
  chair?: string;
  doctorId?: string | null;
  counselorId?: string | null;
  memo?: string | null;
  discountRate?: number;
};

export async function updateAppointment(
  client: DbClient,
  id: string,
  input: UpdateAppointmentInput,
  now: Date,
): Promise<{ before: Appointment; after: Appointment; fields: string[] }> {
  const before = await client.appointment.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "예약을 찾을 수 없습니다.");

  const fields = Object.keys(input).filter((key) => input[key as keyof UpdateAppointmentInput] !== undefined);
  const placement = ["treatmentItem", "chair", "doctorId", "counselorId"].filter((key) => fields.includes(key));
  if (placement.length > 0) {
    if (kstDateKey(before.startAt) < kstDateKey(now)) {
      throw new ApiError(409, "PAST_APPOINTMENT", "지난 날의 예약은 항목·체어·담당자를 바꿀 수 없습니다. 메모와 할인율만 고칠 수 있습니다.");
    }
    if (!(SLOT_HOLDING_STATUSES as readonly string[]).includes(before.status)) {
      throw new ApiError(409, "INVALID_STATUS", "노쇼·취소·변경된 예약은 항목·체어·담당자를 바꿀 수 없습니다.");
    }
  }

  const settings = placement.length > 0 ? await getClinicSettings(client) : null;
  const treatmentItem = input.treatmentItem ?? before.treatmentItem;
  const chair = input.chair ?? before.chair;
  if (settings) {
    if (input.treatmentItem !== undefined && !settings.treatmentItems.includes(input.treatmentItem)) {
      throw invalidField("treatmentItem", "unknown_item");
    }
    if (input.chair !== undefined) assertChair(settings, input.chair);
    // 상담하다 일반 진료로 바뀐 경우: 진료 체어를 같이 골라야 한다(상담실 열에서 빠진다).
    if (input.treatmentItem !== undefined || input.chair !== undefined) assertConsultRoomItem(settings, chair, treatmentItem);
    await assertStaffRole(client, input.doctorId, DOCTOR_ROLES, "doctorId");
    await assertStaffRole(client, input.counselorId, COUNSELOR_ROLES, "counselorId");
  }

  try {
    // 보낸 칸만 바꾼다(undefined는 Prisma가 건드리지 않는다). 상태(status)는 여기서 쓰지 않는다
    // (상태는 status.ts만 — visit-status.test.ts가 객체 리터럴을 검사한다).
    const after = await client.appointment.update({
      where: { id },
      data: {
        treatmentItem: input.treatmentItem,
        listPrice: input.treatmentItem === undefined ? undefined : treatmentMetaOf(settings!.treatmentItemMeta, treatmentItem).price,
        chair: input.chair,
        doctorId: input.doctorId,
        counselorId: input.counselorId,
        memo: input.memo,
        discountRate: input.discountRate,
      },
    });
    return { before, after, fields };
  } catch (error) {
    if (isChairOverlapError(error)) throw chairConflictError();
    throw error;
  }
}
