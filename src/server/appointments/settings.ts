import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { BusinessHours, ClinicSettings } from "@/lib/domain/clinic";
import { DEFAULT_TREATMENT_ITEM_META, PRICE_MAX, TREATMENT_CATEGORIES } from "@/lib/domain/treatment";
import { isValidTime } from "@/lib/time/kst";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { log } from "@/server/log";

/**
 * 병원 설정 읽기 — clinic_setting(항상 1행)의 JSON 컬럼을 검증해 ClinicSettings로 돌려준다.
 * 예약 생성·이동(체어·예약 항목 확인)과 GET /api/settings가 쓴다. 캐시하지 않고 요청마다 읽는다.
 */

const time = z.string().refine(isValidTime);
const dayHours = z.object({ open: time, close: time }).nullable();

const settingsSchema = z.object({
  lateToleranceMin: z.number().int().min(0),
  noShowGraceMin: z.number().int().min(0),
  businessHours: z.object({
    "0": dayHours,
    "1": dayHours,
    "2": dayHours,
    "3": dayHours,
    "4": dayHours,
    "5": dayHours,
    "6": dayHours,
  }) satisfies z.ZodType<BusinessHours>,
  chairs: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      kind: z.enum(["CHAIR", "CONSULT_ROOM"]),
      group: z.string().min(1).optional(),
    }),
  ),
  treatmentItems: z.array(z.string().min(1)),
  treatmentItemMeta: z.record(
    z.string(),
    z.object({
      category: z.enum(TREATMENT_CATEGORIES),
      price: z.number().int().min(0).max(PRICE_MAX).nullable(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    }),
  ),
}) satisfies z.ZodType<ClinicSettings>;

type SettingsClient = Pick<Prisma.TransactionClient, "clinicSetting">;

export async function getClinicSettings(client: SettingsClient = db): Promise<ClinicSettings> {
  const row = await client.clinicSetting.findUnique({ where: { id: 1 } });
  if (!row) throw new ApiError(500, "SETTINGS_MISSING", "병원 설정이 없습니다. npm run db:seed");
  const parsed = settingsSchema.safeParse({
    lateToleranceMin: row.lateToleranceMin,
    noShowGraceMin: row.noShowGraceMin,
    businessHours: row.businessHours,
    chairs: row.chairs,
    treatmentItems: row.treatmentItems,
    // 마이그레이션 전 행(null)은 기본값을 쓴다.
    treatmentItemMeta: row.treatmentItemMeta ?? DEFAULT_TREATMENT_ITEM_META,
  });
  if (!parsed.success) {
    log.error("settings.invalid", { issueCount: parsed.error.issues.length });
    throw new ApiError(500, "SETTINGS_INVALID", "병원 설정 형식이 올바르지 않습니다. 관리자에게 알려 주세요.");
  }
  return parsed.data;
}
