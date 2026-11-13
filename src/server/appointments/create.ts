import "server-only";

import { isPremiumItem, treatmentMetaOf } from "@/lib/domain/treatment";
import type { Appointment, Prisma } from "@/generated/prisma/client";
import type { AppointmentChannel } from "@/lib/domain/appointment";
import type { ClinicSettings } from "@/lib/domain/clinic";
import type { StaffRole } from "@/lib/domain/staff";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { getClinicSettings } from "./settings";

/**
 * 예약 생성 — T4-1. 예약 API, 예약변경(새 예약), 워크인 등록이 함께 쓴다.
 *
 * - 체어·예약 항목은 병원 설정에 있는 값만, 소요시간은 5~480분(5분 단위)만 받는다.
 * - 의사는 재직 중인 DOCTOR(또는 ADMIN), 상담자는 재직 중인 COUNSELOR(또는 ADMIN)만.
 * - 예약 행과 상태 이력 첫 행(null → BOOKED)을 한 트랜잭션에 쓴다.
 * - 같은 체어·겹치는 시간은 DB 제약 appointment_no_chair_overlap이 막고, 409 CHAIR_CONFLICT로 바꾼다.
 *   (동시에 두 요청이 같은 자리를 잡아도 하나만 성공한다.)
 */

export const DURATION_MIN = 5;
export const DURATION_MAX = 480;
export const SLOT_MINUTES = 5;
const SLOT_MS = SLOT_MINUTES * 60_000;

export type CreateAppointmentInput = {
  patientId: string;
  startAt: Date;
  durationMin: number;
  doctorId?: string | null;
  counselorId?: string | null;
  chair: string;
  treatmentItem: string;
  channel: AppointmentChannel;
  memo?: string | null;
};

export type CreateAppointmentOptions = {
  /** 등록한 직원 — created_by_id, visit_status_log.staff_id */
  actorId: string;
  /** 입력 기기 (요청 헤더 x-input-device) */
  inputDevice?: string | null;
  /** 예약변경으로 만드는 새 예약이면 원 예약 id (내부 전용, 공개 API에서는 받지 않는다) */
  originalAppointmentId?: string;
  /** 다른 쓰기와 한 트랜잭션으로 묶을 때 넘긴다. 없으면 이 함수가 트랜잭션을 연다. */
  tx?: Prisma.TransactionClient;
};

/** 시작 시각이 5분 단위(초·밀리초 0)인지. 한국 시간은 UTC+9 정시 차이라 UTC 기준으로 봐도 같다. */
export function isOnSlotBoundary(instant: Date): boolean {
  return instant.getTime() % SLOT_MS === 0;
}

export function isValidDuration(durationMin: number): boolean {
  return (
    Number.isInteger(durationMin) &&
    durationMin >= DURATION_MIN &&
    durationMin <= DURATION_MAX &&
    durationMin % SLOT_MINUTES === 0
  );
}

/** 검증 실패 — defineRoute의 입력 검증과 같은 모양(필드 경로와 코드만)으로 400을 낸다. */
export function invalidField(path: string, code: string): ApiError {
  return new ApiError(400, "VALIDATION_FAILED", "입력값을 확인하세요.", { fields: [{ path, code }] });
}

export function assertDuration(durationMin: number): void {
  if (!isValidDuration(durationMin)) throw invalidField("durationMin", "invalid_duration");
}

/** 상담실(CONSULT_ROOM)에는 고가 항목 예약만 둔다 (F-5) */
export const GENERAL_IN_CONSULT_ROOM_MESSAGE = "상담실에는 고가(상담 대상) 항목 예약만 넣을 수 있습니다. 일반 진료는 진료 체어를 고르세요.";

export function assertConsultRoomItem(settings: ClinicSettings, chair: string, treatmentItem: string): void {
  const room = settings.chairs.find((c) => c.code === chair);
  if (room?.kind === "CONSULT_ROOM" && !isPremiumItem(settings.treatmentItemMeta, treatmentItem)) {
    throw new ApiError(400, "GENERAL_ITEM_IN_CONSULT_ROOM", GENERAL_IN_CONSULT_ROOM_MESSAGE);
  }
}

export function assertChair(settings: ClinicSettings, chair: string): void {
  if (!settings.chairs.some((c) => c.code === chair)) throw invalidField("chair", "unknown_chair");
}

export function endAtOf(startAt: Date, durationMin: number): Date {
  return new Date(startAt.getTime() + durationMin * 60_000);
}

/** PostgreSQL 제외 제약(23P01) appointment_no_chair_overlap 위반인지. Prisma 드라이버 어댑터 에러의 원인을 본다. */
export function isChairOverlapError(error: unknown): boolean {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } })
    ?.meta?.driverAdapterError?.cause;
  return cause?.originalCode === "23P01" && (cause.originalMessage ?? "").includes("appointment_no_chair_overlap");
}

export function chairConflictError(): ApiError {
  return new ApiError(409, "CHAIR_CONFLICT", "같은 체어에 겹치는 예약이 있습니다");
}

export const DOCTOR_ROLES: readonly StaffRole[] = ["DOCTOR", "ADMIN"];
export const COUNSELOR_ROLES: readonly StaffRole[] = ["COUNSELOR", "ADMIN"];

export async function assertStaffRole(
  tx: Pick<Prisma.TransactionClient, "staff">,
  id: string | null | undefined,
  roles: readonly StaffRole[],
  path: string,
): Promise<void> {
  if (!id) return;
  const staff = await tx.staff.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (!staff || !staff.isActive || !roles.includes(staff.role)) throw invalidField(path, "invalid_staff");
}

async function insert(
  tx: Prisma.TransactionClient,
  input: CreateAppointmentInput,
  options: CreateAppointmentOptions,
): Promise<Appointment> {
  const settings = await getClinicSettings(tx);
  assertChair(settings, input.chair);
  if (!settings.treatmentItems.includes(input.treatmentItem)) throw invalidField("treatmentItem", "unknown_item");
  assertConsultRoomItem(settings, input.chair, input.treatmentItem);
  assertDuration(input.durationMin);
  await assertStaffRole(tx, input.doctorId, DOCTOR_ROLES, "doctorId");
  await assertStaffRole(tx, input.counselorId, COUNSELOR_ROLES, "counselorId");
  const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
  if (!patient) throw new ApiError(404, "PATIENT_NOT_FOUND", "고객을 찾을 수 없습니다.");

  const appointment = await tx.appointment.create({
    data: {
      patientId: input.patientId,
      startAt: input.startAt,
      durationMin: input.durationMin,
      endAt: endAtOf(input.startAt, input.durationMin),
      doctorId: input.doctorId ?? null,
      counselorId: input.counselorId ?? null,
      chair: input.chair,
      treatmentItem: input.treatmentItem,
      channel: input.channel,
      memo: input.memo ?? null,
      listPrice: treatmentMetaOf(settings.treatmentItemMeta, input.treatmentItem).price,
      status: "BOOKED",
      originalAppointmentId: options.originalAppointmentId ?? null,
      createdById: options.actorId,
    },
  });
  await tx.visitStatusLog.create({
    data: {
      appointmentId: appointment.id,
      fromStatus: null,
      toStatus: "BOOKED",
      staffId: options.actorId,
      inputDevice: options.inputDevice ?? null,
    },
  });
  return appointment;
}

export async function createAppointment(
  input: CreateAppointmentInput,
  options: CreateAppointmentOptions,
): Promise<Appointment> {
  try {
    return options.tx ? await insert(options.tx, input, options) : await db.$transaction((tx) => insert(tx, input, options));
  } catch (error) {
    if (isChairOverlapError(error)) throw chairConflictError();
    throw error;
  }
}
