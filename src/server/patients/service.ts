import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AppointmentStatus } from "@/lib/domain/appointment";
import type { Gender, ReferralSource, VisitType } from "@/lib/domain/patient";
import { maskName } from "@/lib/masking";
import { formatPhone, maskPhone, normalizePhone } from "@/lib/phone";
import { type DateKey, kstDayRange } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import { hashPhone, hashPhoneLast4, openBirthDate, openPhone, phoneSearchHash, sealBirthDate, sealPhone } from "@/server/crypto/pii";
import { db, type DbClient } from "@/server/db";
import type { CreatePatientInput, UpdatePatientInput } from "./schema";

/**
 * 고객 서비스 — T3-1(등록·수정, 같은 번호 경고), T3-2(검색).
 * 권한 검사·감사 로그는 route.ts의 defineRoute가 한다. 여기서는 이름·번호를 로그·에러 문구에 넣지 않는다.
 * 등록·수정은 route가 넘긴 client(ctx.db, 감사 행과 같은 트랜잭션)로 쓴다.
 */

// ── 검색 ────────────────────────────────────────────────────────────

/** 검색 방식. 감사 행 detail에 코드로 남긴다(검색어 원문은 남기지 않는다). */
export type SearchKind = "recent" | "last4" | "phone" | "chart" | "name";

/** 목록용 고객 — 이름·번호는 마스킹 (기획서 10장) */
export type PatientListItem = {
  id: string;
  nameMasked: string;
  phoneMasked: string;
  birthYear: number | null;
  gender: Gender | null;
  visitType: VisitType;
  referralSource: ReferralSource | null;
  tags: string[];
  dentwebChartNo: string | null;
  noShowCount: number;
};

/** 차트번호처럼 보이는 검색어: 영문·숫자·하이픈만, 숫자를 하나 이상 포함 (예: F000123, 12345) */
const CHART_NO_QUERY_RE = /^(?=.*\d)[A-Za-z0-9-]+$/;

export function searchKindOf(query: string): SearchKind {
  const q = query.trim();
  if (!q) return "recent";
  const phone = phoneSearchHash(q);
  if (phone) return phone.kind === "last4" ? "last4" : "phone";
  if (CHART_NO_QUERY_RE.test(q)) return "chart";
  return "name";
}

const listSelect = {
  id: true,
  name: true,
  phoneEnc: true,
  birthDateEnc: true,
  gender: true,
  visitType: true,
  referralSource: true,
  tags: true,
  dentwebChartNo: true,
  noShowCount: true,
} satisfies Prisma.PatientSelect;

type ListRow = Prisma.PatientGetPayload<{ select: typeof listSelect }>;

function birthYearOf(birthDateEnc: string | null): number | null {
  return birthDateEnc ? Number(openBirthDate(birthDateEnc).slice(0, 4)) : null;
}

function toListItem(row: ListRow): PatientListItem {
  return {
    id: row.id,
    nameMasked: maskName(row.name),
    phoneMasked: maskPhone(openPhone(row.phoneEnc)),
    birthYear: birthYearOf(row.birthDateEnc),
    gender: row.gender,
    visitType: row.visitType,
    referralSource: row.referralSource,
    tags: row.tags,
    dentwebChartNo: row.dentwebChartNo,
    noShowCount: row.noShowCount,
  };
}

function chartNoWhere(q: string): Prisma.PatientWhereInput {
  return { dentwebChartNo: { equals: q, mode: "insensitive" } };
}

export type SearchOptions = {
  limit: number;
  /** "phoneLast4": 번호 뒷 4자리 해시만 찾는다(숫자 차트번호 일치를 섞지 않는다). 검증은 schema가 한다. */
  kind?: "phoneLast4";
  /**
   * 그날(한국 시간) 시작하는 예약이 있는 고객으로 좁힌다. 이때는 limit을 적용하지 않는다.
   * kind=phoneLast4와 함께일 때만 쓴다(API에서는 schema가 강제한다).
   */
  appointmentDate?: DateKey;
};

/**
 * 고객 검색. 숫자 4개 → 뒷 4자리 해시, 전체 번호 → 번호 해시(둘 다 숫자 차트번호 일치도 포함),
 * 차트번호 모양 → 차트번호 일치,
 * 그 밖 → 이름 포함(대소문자 무시). 빈 검색어 → 최근 등록 순.
 * options.kind가 "phoneLast4"이면 뒷 4자리 해시만 본다.
 */
export async function searchPatients(
  query: string,
  options: SearchOptions,
): Promise<{ kind: SearchKind; items: PatientListItem[] }> {
  const q = query.trim();
  const kind: SearchKind = options.kind === "phoneLast4" ? "last4" : searchKindOf(q);
  let where: Prisma.PatientWhereInput = {};
  if (options.kind === "phoneLast4") {
    where = { phoneLast4Hash: hashPhoneLast4(q) };
  } else if (kind === "last4" || kind === "phone") {
    const hash = phoneSearchHash(q)!.hash;
    where = kind === "last4" ? { phoneLast4Hash: hash } : { phoneHash: hash };
    // 숫자만 쓰는 차트번호(예: 1234, 0312345678)는 번호 검색과 모양이 같으므로 차트번호 일치도 함께 찾는다.
    if (CHART_NO_QUERY_RE.test(q)) where = { OR: [where, chartNoWhere(q)] };
  } else if (kind === "chart") {
    where = chartNoWhere(q);
  } else if (kind === "name") {
    where = { name: { contains: q, mode: "insensitive" } };
  }
  if (options.appointmentDate) {
    const { start, end } = kstDayRange(options.appointmentDate);
    where = { AND: [where, { appointments: { some: { startAt: { gte: start, lt: end } } } }] };
  }
  const rows = await db.patient.findMany({
    where,
    select: listSelect,
    orderBy: kind === "name" ? [{ name: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    // 날짜로 좁히면 결과는 그날 예약한 고객 중 뒷 4자리가 같은 고객뿐이다 — 상한을 두면 그날 고객이 빠질 수 있어 두지 않는다.
    ...(options.appointmentDate ? {} : { take: options.limit }),
  });
  return { kind, items: rows.map(toListItem) };
}

// ── 상세 ────────────────────────────────────────────────────────────

export const APPOINTMENT_HISTORY_MAX = 50;

export type PatientDetail = {
  id: string;
  name: string;
  /** "010-0123-4567" */
  phone: string;
  /** "YYYY-MM-DD" */
  birthDate: string | null;
  gender: Gender | null;
  visitType: VisitType;
  referralSource: ReferralSource | null;
  tags: string[];
  dentwebChartNo: string | null;
  memo: string | null;
  noShowCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PatientAppointmentItem = {
  id: string;
  startAt: string;
  durationMin: number;
  status: AppointmentStatus;
  treatmentItem: string;
  chair: string;
};

export async function getPatientDetail(
  id: string,
): Promise<{ patient: PatientDetail; appointments: PatientAppointmentItem[] } | null> {
  const row = await db.patient.findUnique({
    where: { id },
    include: {
      appointments: {
        select: { id: true, startAt: true, durationMin: true, status: true, treatmentItem: true, chair: true },
        orderBy: [{ startAt: "desc" }, { id: "desc" }],
        take: APPOINTMENT_HISTORY_MAX,
      },
    },
  });
  if (!row) return null;
  return {
    patient: {
      id: row.id,
      name: row.name,
      phone: formatPhone(openPhone(row.phoneEnc)),
      birthDate: row.birthDateEnc ? openBirthDate(row.birthDateEnc) : null,
      gender: row.gender,
      visitType: row.visitType,
      referralSource: row.referralSource,
      tags: row.tags,
      dentwebChartNo: row.dentwebChartNo,
      memo: row.memo,
      noShowCount: row.noShowCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    appointments: row.appointments.map((a) => ({ ...a, startAt: a.startAt.toISOString() })),
  };
}

// ── 등록·수정 ───────────────────────────────────────────────────────

export const DUPLICATE_PHONE_MESSAGE = "같은 번호로 등록된 고객이 있습니다. 같은 사람이 아닌지 확인하세요.";
const DUPLICATE_CHART_NO_MESSAGE = "이미 다른 고객에게 등록된 차트번호입니다.";
export const NOT_FOUND_MESSAGE = "고객을 찾을 수 없습니다.";

/** 같은 번호 경고에 보여 줄 고객 — 마스킹한 이름과 출생 연도만 */
export type DuplicatePatient = { id: string; nameMasked: string; birthYear: number | null };

/** 결과: 저장했거나, 같은 번호의 다른 고객이 있어 저장하지 않았다(경고). */
export type SaveResult = { kind: "saved"; id: string } | { kind: "duplicatePhone"; duplicates: DuplicatePatient[] };

const DUPLICATES_SHOWN = 10;

async function findPhoneDuplicates(client: DbClient, phoneHash: string, exceptId?: string): Promise<DuplicatePatient[]> {
  const rows = await client.patient.findMany({
    where: { phoneHash, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true, birthDateEnc: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: DUPLICATES_SHOWN,
  });
  return rows.map((row) => ({ id: row.id, nameMasked: maskName(row.name), birthYear: birthYearOf(row.birthDateEnc) }));
}

/**
 * 입력은 스키마에서 대문자로 맞추지만, 이 변경 전에 소문자로 저장된 행이 남아 있을 수 있다.
 * DB unique 제약은 대소문자를 구분하므로 사전 검사는 대소문자를 무시하고 비교해 그런 행과의 중복도 막는다.
 */
async function assertChartNoFree(client: DbClient, chartNo: string | null | undefined, exceptId?: string): Promise<void> {
  if (!chartNo) return;
  const taken = await client.patient.findFirst({
    where: { ...chartNoWhere(chartNo), ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) throw new ApiError(409, "DUPLICATE_CHART_NO", DUPLICATE_CHART_NO_MESSAGE);
}

/** 동시에 같은 차트번호를 저장하면 unique 제약이 막는다 → 같은 409로 바꾼다. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } } | null;
  return e?.code === "P2002" || e?.meta?.driverAdapterError?.cause?.originalCode === "23505";
}

async function withChartNoConflict<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, "DUPLICATE_CHART_NO", DUPLICATE_CHART_NO_MESSAGE);
    throw error;
  }
}

export async function createPatient(input: CreatePatientInput, staffId: string, client: DbClient = db): Promise<SaveResult> {
  const sealed = sealPhone(input.phone);
  if (!input.confirmDuplicate) {
    const duplicates = await findPhoneDuplicates(client, sealed.phoneHash);
    if (duplicates.length > 0) return { kind: "duplicatePhone", duplicates };
  }
  await assertChartNoFree(client, input.dentwebChartNo);
  const created = await withChartNoConflict(
    client.patient.create({
      data: {
        name: input.name,
        ...sealed,
        birthDateEnc: input.birthDate ? sealBirthDate(input.birthDate) : null,
        gender: input.gender ?? null,
        visitType: input.visitType ?? "NEW",
        referralSource: input.referralSource ?? null,
        tags: input.tags ?? [],
        dentwebChartNo: input.dentwebChartNo ?? null,
        memo: input.memo ?? null,
        createdById: staffId,
      },
      select: { id: true },
    }),
  );
  return { kind: "saved", id: created.id };
}

export async function updatePatient(id: string, input: UpdatePatientInput, client: DbClient = db): Promise<SaveResult> {
  const current = await client.patient.findUnique({ where: { id }, select: { id: true, phoneHash: true } });
  if (!current) throw new ApiError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);

  const data: Prisma.PatientUpdateInput = {};
  if (input.phone !== undefined) {
    // 번호가 그대로면 다시 암호화하지 않는다(경고도 다시 띄우지 않는다).
    const changed = hashPhone(normalizePhone(input.phone)!) !== current.phoneHash;
    if (changed) {
      const sealed = sealPhone(input.phone);
      if (!input.confirmDuplicate) {
        const duplicates = await findPhoneDuplicates(client, sealed.phoneHash, id);
        if (duplicates.length > 0) return { kind: "duplicatePhone", duplicates };
      }
      Object.assign(data, sealed);
    }
  }
  if (input.dentwebChartNo !== undefined) {
    await assertChartNoFree(client, input.dentwebChartNo, id);
    data.dentwebChartNo = input.dentwebChartNo;
  }
  if (input.name !== undefined) data.name = input.name;
  if (input.birthDate !== undefined) data.birthDateEnc = input.birthDate ? sealBirthDate(input.birthDate) : null;
  if (input.gender !== undefined) data.gender = input.gender;
  if (input.referralSource !== undefined) data.referralSource = input.referralSource;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.memo !== undefined) data.memo = input.memo;
  if (input.visitType !== undefined) data.visitType = input.visitType;

  if (Object.keys(data).length > 0) {
    await withChartNoConflict(client.patient.update({ where: { id }, data, select: { id: true } }));
  }
  return { kind: "saved", id };
}
