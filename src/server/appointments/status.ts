import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  REASON_REQUIRED_STATUSES,
  isArrivedStatus,
  type AppointmentStatus,
  type VisitReasonCode,
} from "@/lib/domain/appointment";
import { isLateArrival } from "@/lib/visit/lateness";
import { validateTransition, type TransitionErrorCode } from "@/lib/visit/transitions";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { chairConflictError, isChairOverlapError } from "./create";

/**
 * 예약 상태 변경 — T5-2 (기획서 4-1, 4-3 규칙 1~3).
 *
 * appointment.status를 바꾸는 길은 이 함수, 예약 생성(create.ts, 첫 BOOKED와 그 이력), 예약변경(reschedule.ts, 이 함수를 씀)뿐이다.
 * 상태 변경과 visit_status_log 한 행 추가는 항상 한 트랜잭션이다. 이력을 쓰지 못하면 상태도 바뀌지 않는다.
 * tests/integration/visit-status.test.ts가 다른 파일에서 status를 쓰는 코드가 없는지 검사한다.
 */

type Tx = Prisma.TransactionClient;

export type StatusActor = { id: string };

export type ChangeStatusInput = {
  appointmentId: string;
  to: AppointmentStatus;
  reasonCode?: VisitReasonCode | null;
  /** 화면이 보고 있던 상태. 다르면 다른 곳(다른 PC, 두 번 클릭)에서 먼저 바뀐 것이다 */
  expectedStatus: AppointmentStatus;
  actor: StatusActor;
  /** 서버 시각 (ctx.now) */
  now: Date;
  inputDevice?: string | null;
};

export type ChangeStatusResult = {
  appointment: {
    id: string;
    patientId: string;
    status: AppointmentStatus;
    startAt: Date;
    arrivedAt: Date | null;
  };
  fromStatus: AppointmentStatus;
  /** 지각내원 여부 (저장하지 않고 계산) */
  isLate: boolean;
};

const INPUT_DEVICE_MAX = 64;

/** 시각·상태에 따라 지금은 안 되는 것은 409, 요청 내용이 틀린 것은 400 */
const TRANSITION_ERROR_STATUS: Record<TransitionErrorCode, number> = {
  NOT_ALLOWED: 409,
  NO_SHOW_TOO_EARLY: 409,
  ARRIVAL_BEFORE_APPOINTMENT_DAY: 409,
  REASON_REQUIRED: 400,
  CANCEL_IS_SAME_DAY: 400,
  CANCEL_IS_ADVANCE: 400,
};

const visitSettingsSchema = z.object({
  noShowGraceMin: z.number().int().min(0),
  lateToleranceMin: z.number().int().min(0),
});

/** 병원 설정 중 상태 변경에 필요한 두 값 (노쇼 유예시간, 지각 허용시간) */
async function readVisitSettings(tx: Tx) {
  const row = await tx.clinicSetting.findUnique({
    where: { id: 1 },
    select: { noShowGraceMin: true, lateToleranceMin: true },
  });
  const parsed = visitSettingsSchema.safeParse(row);
  if (!parsed.success) {
    throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없거나 올바르지 않습니다. 관리자에게 알려 주세요.");
  }
  return parsed.data;
}

/** 예약 행을 잠그고(SELECT … FOR UPDATE) 읽는다. 트랜잭션이 끝날 때까지 다른 변경은 기다린다. */
export async function lockAppointment(tx: Tx, appointmentId: string) {
  await tx.$queryRaw`SELECT id FROM "appointment" WHERE id = ${appointmentId}::uuid FOR UPDATE`;
  const appointment = await tx.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, patientId: true, status: true, startAt: true, arrivedAt: true },
  });
  if (!appointment) throw new ApiError(404, "NOT_FOUND", "예약을 찾을 수 없습니다.");
  return appointment;
}

/**
 * 상태를 바꾸고 이력을 남긴다. client를 주면 그 트랜잭션 안에서(예약변경), 없으면 새 트랜잭션에서 실행한다.
 * 실패는 ApiError: 404 NOT_FOUND, 409 STATUS_CHANGED, 400/409 전환 규칙 코드(transitions.ts), 409 CHAIR_CONFLICT.
 */
export async function changeStatus(input: ChangeStatusInput, client?: Tx): Promise<ChangeStatusResult> {
  if (client) return changeStatusIn(client, input);
  return db.$transaction((tx) => changeStatusIn(tx, input));
}

async function changeStatusIn(tx: Tx, input: ChangeStatusInput): Promise<ChangeStatusResult> {
  const { appointmentId, to, expectedStatus, actor, now } = input;

  // 1. 잠그고 읽기
  const current = await lockAppointment(tx, appointmentId);
  const from = current.status;

  // 2. 화면이 본 상태와 다르면 거부 (두 번 클릭, 두 PC)
  if (from !== expectedStatus) {
    throw new ApiError(409, "STATUS_CHANGED", "다른 곳에서 상태가 바뀌었습니다. 새로고침하세요.");
  }

  // 3. 전환 규칙 (서버 시각)
  const settings = await readVisitSettings(tx);
  const needsReason = (REASON_REQUIRED_STATUSES as readonly AppointmentStatus[]).includes(to);
  const reasonCode = needsReason ? (input.reasonCode ?? null) : null;
  const check = validateTransition({
    from,
    to,
    startAt: current.startAt,
    now,
    noShowGraceMin: settings.noShowGraceMin,
    reasonCode,
  });
  if (!check.ok) throw new ApiError(TRANSITION_ERROR_STATUS[check.code], check.code, check.message);

  // 4. 상태와 내원 시각. 원내 단계(내원·진료중·수납·귀가) 사이에서는 처음 내원한 시각을 유지한다
  const arrivedAt = isArrivedStatus(to) ? (isArrivedStatus(from) ? current.arrivedAt : now) : null;
  //    노쇼·취소에서 다시 자리를 차지하는 상태로 갈 때, 비운 자리에 다른 예약이 들어왔으면 DB 제약이 막는다 → 409
  let updated: ChangeStatusResult["appointment"];
  try {
    updated = await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: to, arrivedAt },
      select: { id: true, patientId: true, status: true, startAt: true, arrivedAt: true },
    });
  } catch (error) {
    if (isChairOverlapError(error)) throw chairConflictError();
    throw error;
  }

  // 5. 노쇼 누적 횟수 캐시
  if (to === "NO_SHOW") {
    await tx.patient.update({ where: { id: current.patientId }, data: { noShowCount: { increment: 1 } } });
  } else if (from === "NO_SHOW") {
    await tx.patient.updateMany({
      where: { id: current.patientId, noShowCount: { gt: 0 } },
      data: { noShowCount: { decrement: 1 } },
    });
  }

  // 6. 이력 한 행. 같은 예약의 이력은 시각순으로 정렬되도록 직전 행보다 늦은 시각을 쓴다
  //    (요청 시각은 잠금을 기다리기 전에 정해지므로, 드물게 직전 행보다 이를 수 있다)
  const last = await tx.visitStatusLog.findFirst({
    where: { appointmentId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const createdAt =
    last && last.createdAt.getTime() >= now.getTime() ? new Date(last.createdAt.getTime() + 1) : now;
  await tx.visitStatusLog.create({
    data: {
      appointmentId,
      fromStatus: from,
      toStatus: to,
      reasonCode,
      staffId: actor.id,
      createdAt,
      inputDevice: input.inputDevice ? input.inputDevice.slice(0, INPUT_DEVICE_MAX) : null,
    },
  });

  return {
    appointment: updated,
    fromStatus: from,
    isLate: updated.arrivedAt ? isLateArrival(updated.startAt, updated.arrivedAt, settings.lateToleranceMin) : false,
  };
}

/**
 * 되돌리기 (보드의 5초 되돌리기와 이후 정정). 최신 이력의 이전 상태로 되돌린다.
 * 노쇼·당일취소로 되돌릴 때는 그 상태로 들어갔던 가장 최근 이력의 사유를 다시 쓴다.
 * 최신 이력이 예약 생성 행(이전 상태 없음)이면 409 NOTHING_TO_REVERT.
 */
export async function revertStatus(input: Omit<ChangeStatusInput, "to" | "reasonCode">): Promise<ChangeStatusResult> {
  return db.$transaction(async (tx) => {
    await lockAppointment(tx, input.appointmentId);
    const latest = await tx.visitStatusLog.findFirst({
      where: { appointmentId: input.appointmentId },
      orderBy: { createdAt: "desc" },
      select: { fromStatus: true },
    });
    if (!latest?.fromStatus) {
      throw new ApiError(409, "NOTHING_TO_REVERT", "되돌릴 상태 변경이 없습니다.");
    }
    const to = latest.fromStatus;
    let reasonCode: VisitReasonCode | null = null;
    if ((REASON_REQUIRED_STATUSES as readonly AppointmentStatus[]).includes(to)) {
      const entered = await tx.visitStatusLog.findFirst({
        where: { appointmentId: input.appointmentId, toStatus: to },
        orderBy: { createdAt: "desc" },
        select: { reasonCode: true },
      });
      reasonCode = entered?.reasonCode ?? null;
    }
    return changeStatusIn(tx, { ...input, to, reasonCode });
  });
}
