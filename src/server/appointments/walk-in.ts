import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { createAppointment, SLOT_MINUTES } from "./create";
import { changeStatus, type ChangeStatusInput } from "./status";

/**
 * 워크인 등록 — T5-5 (기획서 4-2 빠른 검색 옆 [워크인 등록]). 예약 없이 온 고객을 바로 내원 처리한다.
 * - 예약 채널 '워크인'으로 지금 시각(5분 단위로 내림)에 예약을 만들고, 같은 트랜잭션에서 내원으로 바꾼다.
 *   상태 이력은 일반 예약과 같이 두 행(null → 예약확정, 예약확정 → 내원)이 남는다(같은 입력자·기기).
 * - 체어가 겹치면 409 CHAIR_CONFLICT로 아무것도 남기지 않는다(트랜잭션). 통계는 채널별로 따로 센다(visit-report byChannel).
 */
export type WalkInInput = {
  patientId: string;
  chair: string;
  treatmentItem: string;
  durationMin: number;
  doctorId?: string | null;
  counselorId?: string | null;
  memo?: string | null;
};

export function walkInStart(now: Date): Date {
  const slot = SLOT_MINUTES * 60_000;
  return new Date(Math.floor(now.getTime() / slot) * slot);
}

export async function registerWalkIn(
  tx: Prisma.TransactionClient,
  input: WalkInInput,
  options: { actor: ChangeStatusInput["actor"]; now: Date; inputDevice: string | null },
) {
  const created = await createAppointment(
    { ...input, startAt: walkInStart(options.now), channel: "WALK_IN" },
    { actorId: options.actor.id, inputDevice: options.inputDevice, tx },
  );
  return changeStatus(
    { appointmentId: created.id, to: "ARRIVED", expectedStatus: "BOOKED", actor: options.actor, now: options.now, inputDevice: options.inputDevice },
    tx,
  );
}
