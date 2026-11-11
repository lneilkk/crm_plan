import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as dbEnums from "@/generated/prisma/enums";
import {
  APPOINTMENT_CHANNELS,
  APPOINTMENT_STATUSES,
  SLOT_HOLDING_STATUSES,
  VISIT_REASON_CODES,
} from "@/lib/domain/appointment";
import { CONSENT_TYPES, GENDERS, REFERRAL_SOURCES, VISIT_TYPES } from "@/lib/domain/patient";
import { STAFF_ROLES } from "@/lib/domain/staff";

/**
 * DB enum(prisma/schema.prisma)과 공용 상수(src/lib/domain)가 어긋나지 않는지 검사한다.
 * 한쪽에만 값을 추가하면 화면·검증 코드는 그 값을 쓰는데 DB가 거부하거나, 그 반대가 된다.
 * 순서까지 같게 유지한다(화면의 선택지 순서가 상수 배열 순서를 따른다).
 */
const PAIRS = [
  ["StaffRole", dbEnums.StaffRole, STAFF_ROLES],
  ["Gender", dbEnums.Gender, GENDERS],
  ["VisitType", dbEnums.VisitType, VISIT_TYPES],
  ["ReferralSource", dbEnums.ReferralSource, REFERRAL_SOURCES],
  ["ConsentType", dbEnums.ConsentType, CONSENT_TYPES],
  ["AppointmentStatus", dbEnums.AppointmentStatus, APPOINTMENT_STATUSES],
  ["AppointmentChannel", dbEnums.AppointmentChannel, APPOINTMENT_CHANNELS],
  ["VisitReasonCode", dbEnums.VisitReasonCode, VISIT_REASON_CODES],
] as const;

describe("DB enum과 공용 상수", () => {
  it.each(PAIRS)("%s의 값이 src/lib/domain 상수 배열과 같다", (_name, dbEnum, domainValues) => {
    expect(Object.values(dbEnum)).toEqual([...domainValues]);
  });

  it("공용 상수가 없는 enum은 기획서 6장 값 그대로다 (상수 배열이 생기면 위 목록으로 옮긴다)", () => {
    expect(Object.values(dbEnums.ConsultationResult)).toEqual(["PENDING", "BOOKED", "NOT_BOOKED"]);
    expect(Object.values(dbEnums.AuditResult)).toEqual(["SUCCESS", "DENIED", "FAILED"]);
  });

  it("모든 Prisma enum을 검사한다 (enum을 추가하면 이 테스트에도 추가해야 한다)", () => {
    const checked = [...PAIRS.map(([name]) => name), "ConsultationResult", "AuditResult"].sort();
    expect(Object.keys(dbEnums).sort()).toEqual(checked);
  });

  it("체어 시간을 차지하는 상태는 마이그레이션의 중복 예약 제약(appointment_no_chair_overlap)과 같은 목록이다", () => {
    const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
    const sql = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf8"))
      .join("\n");
    const match = /"appointment_no_chair_overlap"[\s\S]*?WHERE \("status" IN \(([^)]*)\)\)/.exec(sql);
    expect(match).not.toBeNull();
    const statuses = match![1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
    expect(statuses.sort()).toEqual([...SLOT_HOLDING_STATUSES].sort());
  });
});
