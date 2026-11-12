/**
 * 시드 데이터 (T1-4) — 병원 기본 설정과 역할별 테스트 계정.
 *
 * 실행: npm run db:seed (= prisma db seed → prisma.config.ts의 seed 명령)
 *
 * - 병원 설정(clinic_setting, id 1): 없을 때만 DEFAULT_CLINIC_SETTINGS로 만든다.
 *   이미 있으면 건드리지 않는다(설정 화면에서 바꾼 값이 다시 시드해도 남아야 한다).
 * - 테스트 계정: FAKE_DATA_ALLOWED=true일 때만 만든다. 실제 운영 환경에는 이 변수를 두지 않으므로
 *   운영 DB에서는 만들어지지 않는다. 비밀번호는 SEED_STAFF_PASSWORD(.env)에서 읽는다.
 *   login_id 기준으로 upsert한다. 다시 시드하면 비밀번호 해시를 새로 쓰고, 실패 횟수·잠금을 풀고,
 *   다시 활성화한다(개발 편의). 중복 행은 생기지 않는다.
 * - 출력에는 로그인 아이디와 역할만 넣는다. 비밀번호·해시는 어디에도 출력하지 않는다.
 *
 * "server-only"를 import하는 모듈을 Next.js 밖에서 쓰므로 Node 옵션 --conditions=react-server로 실행한다.
 */
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import type { StaffRole } from "@/lib/domain/staff";
import { hashPassword } from "@/server/auth/password";

/** 테스트 계정 비밀번호 최소 길이 */
export const MIN_SEED_PASSWORD_LENGTH = 12;

/** 역할별 테스트 계정. 이름은 지어낸 것이다(절대 규칙 1). */
export const SEED_STAFF: ReadonlyArray<{ loginId: string; name: string; role: StaffRole }> = [
  { loginId: "admin", name: "김관리", role: "ADMIN" },
  { loginId: "doctor1", name: "이의사", role: "DOCTOR" },
  { loginId: "doctor2", name: "박의사", role: "DOCTOR" },
  { loginId: "front1", name: "최프론트", role: "FRONT" },
  { loginId: "counselor1", name: "정상담", role: "COUNSELOR" },
];

const SEED_BRANCH = "본점";

/** 시드 설정 오류. 메시지에 비밀값을 넣지 않으므로 그대로 출력해도 된다. */
export class SeedConfigError extends Error {
  override name = "SeedConfigError";
}

// process.env를 그대로 넘길 수 있게 다른 변수도 받는다(쓰지는 않는다).
export type SeedEnv = {
  [name: string]: string | undefined;
  FAKE_DATA_ALLOWED?: string;
  SEED_STAFF_PASSWORD?: string;
};

export type SeedResult = {
  /** 이번 실행에서 병원 설정 행을 새로 만들었는지 (이미 있으면 false) */
  clinicSettingCreated: boolean;
  /** 만들거나 갱신한 계정. FAKE_DATA_ALLOWED가 true가 아니어서 건너뛰었으면 null */
  staff: { loginId: string; role: StaffRole }[] | null;
};

export async function seed(db: PrismaClient, env: SeedEnv): Promise<SeedResult> {
  // 계정을 만들 때는 비밀번호부터 확인한다 — DB에 아무것도 쓰기 전에 실패하도록.
  const fakeDataAllowed = env.FAKE_DATA_ALLOWED === "true";
  const password = env.SEED_STAFF_PASSWORD ?? "";
  if (fakeDataAllowed && password.length < MIN_SEED_PASSWORD_LENGTH) {
    // 값은 메시지에 넣지 않는다.
    throw new SeedConfigError(
      `SEED_STAFF_PASSWORD 환경변수가 없거나 ${MIN_SEED_PASSWORD_LENGTH}자보다 짧습니다. .env를 확인하세요 (npm run setup:env).`,
    );
  }

  // INSERT ... ON CONFLICT DO NOTHING: 이미 있는 설정은 그대로 둔다.
  const { count } = await db.clinicSetting.createMany({
    data: [
      {
        id: 1,
        lateToleranceMin: DEFAULT_CLINIC_SETTINGS.lateToleranceMin,
        noShowGraceMin: DEFAULT_CLINIC_SETTINGS.noShowGraceMin,
        businessHours: DEFAULT_CLINIC_SETTINGS.businessHours,
        chairs: DEFAULT_CLINIC_SETTINGS.chairs,
        treatmentItems: DEFAULT_CLINIC_SETTINGS.treatmentItems,
        treatmentItemMeta: DEFAULT_CLINIC_SETTINGS.treatmentItemMeta,
      },
    ],
    skipDuplicates: true,
  });

  if (!fakeDataAllowed) {
    return { clinicSettingCreated: count === 1, staff: null };
  }

  for (const { loginId, name, role } of SEED_STAFF) {
    // 계정마다 따로 해시한다(salt가 달라 해시도 다르다).
    const passwordHash = await hashPassword(password);
    const reset = { passwordHash, failedLoginCount: 0, lockedAt: null, isActive: true };
    await db.staff.upsert({
      where: { loginId },
      create: { loginId, name, role, branch: SEED_BRANCH, ...reset },
      update: { name, role, branch: SEED_BRANCH, ...reset },
    });
  }

  return {
    clinicSettingCreated: count === 1,
    staff: SEED_STAFF.map(({ loginId, role }) => ({ loginId, role })),
  };
}

async function main() {
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
  const { db } = await import("@/server/db");
  try {
    const result = await seed(db, process.env);
    console.log(result.clinicSettingCreated ? "병원 설정: 기본값으로 만들었습니다." : "병원 설정: 이미 있어 그대로 둡니다.");
    if (result.staff === null) {
      console.log("테스트 계정: FAKE_DATA_ALLOWED=true가 아니어서 만들지 않았습니다.");
    } else {
      console.log("테스트 계정 (비밀번호는 .env의 SEED_STAFF_PASSWORD):");
      for (const { loginId, role } of result.staff) console.log(`  ${loginId}\t${role}`);
    }
  } finally {
    await db.$disconnect();
  }
}

// 명령줄에서 직접 실행했을 때만 main을 돈다(통합 테스트는 seed만 import한다).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Prisma 에러 메시지에는 쿼리 인자(비밀번호 해시 등)가 섞일 수 있어 이름·코드만 출력한다.
    if (error instanceof SeedConfigError) {
      console.error(`시드 실패: ${error.message}`);
    } else {
      const code = (error as { code?: unknown } | null)?.code;
      const name = error instanceof Error ? error.name : typeof error;
      console.error(`시드 실패: ${name}${typeof code === "string" ? ` (${code})` : ""}`);
    }
    process.exitCode = 1;
  });
}
