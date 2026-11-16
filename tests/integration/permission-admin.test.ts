/**
 * 확장 계획 S-7 — 직무 × 권한 표, 개인 추가 권한, 민감 권한 확인, 직무 변경 때 추가 권한 다시 확인.
 * 고정 규칙(CHECKLIST.md S 절): 권한 관리자 0명 방지, 권한 변경 감사 로그, 로그 수정·삭제 권한 없음, 민감 권한 확인.
 * 권한은 요청마다 DB에서 계산하므로 바꾸면 그 직원의 다음 요청부터 바로 반영된다.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { GET as consultationsRoute } from "@/app/api/consultations/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { GET as accountsRoute } from "@/app/api/staff/accounts/route";
import { PATCH as staffPatch } from "@/app/api/staff/[id]/route";
import { GET as matrixGet, PUT as matrixPut } from "@/app/api/staff/job-permissions/route";
import { GET as statsRoute } from "@/app/api/stats/route";
import { INITIAL_JOB_PERMISSIONS, PERMISSION_NAMES } from "@/lib/auth/permissions";
import { kstDateKey } from "@/lib/time/kst";
import { callRoute, loginAs } from "./helpers/api";
import { db, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

const TODAY = kstDateKey(new Date());
/** 첫 설치 값(권한 목록 순서 — API가 그 순서로 돌려준다) */
const initial = () =>
  Object.fromEntries(
    Object.entries(INITIAL_JOB_PERMISSIONS).map(([role, list]) => [role, PERMISSION_NAMES.filter((p) => (list as readonly string[]).includes(p))]),
  ) as Record<string, string[]>;
const putMatrix = (cookie: string, jobPermissions: unknown, confirmSensitive?: boolean) =>
  callRoute(matrixPut, { method: "PUT", url: "/api/staff/job-permissions", cookie, body: { jobPermissions, ...(confirmSensitive === undefined ? {} : { confirmSensitive }) } });
const patch = (cookie: string, id: string, body: unknown) => callRoute(staffPatch, { method: "PATCH", url: `/api/staff/${id}`, cookie, params: { id }, body });
const consultCode = async (cookie: string) => (await callRoute(consultationsRoute, { url: `/api/consultations?date=${TODAY}`, cookie })).status;
const statsCode = async (cookie: string) => (await callRoute(statsRoute, { url: `/api/stats?from=${TODAY}&to=${TODAY}&unit=day`, cookie })).status;

describe("직무 × 권한 표 (GET·PUT /api/staff/job-permissions)", () => {
  it("권한 관리 권한이 있는 사람만 읽고 고친다", async () => {
    const front = await loginAs("FRONT");
    expect((await callRoute(matrixGet, { url: "/api/staff/job-permissions", cookie: front.cookie })).status).toBe(403);
    expect((await putMatrix(front.cookie, initial())).status).toBe(403);
    const admin = await loginAs("ADMIN");
    const res = await callRoute(matrixGet, { url: "/api/staff/job-permissions", cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.json.jobPermissions).toEqual(initial());
  });

  it("민감 권한(상담 보기)을 켜려면 확인이 있어야 한다 — 없으면 409이고 아무것도 바뀌지 않는다", async () => {
    const admin = await loginAs("ADMIN");
    const nurse = await loginAs("NURSE");
    const next = initial();
    next.NURSE.push("consult.read");
    const refused = await putMatrix(admin.cookie, next);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("SENSITIVE_CONFIRM_REQUIRED");
    expect(refused.json.error.grants).toEqual(["NURSE:consult.read"]);
    expect(await db.jobPermission.count({ where: { role: "NURSE", permission: "consult.read" } })).toBe(0);
    expect(await consultCode(nurse.cookie)).toBe(403);

    const ok = await putMatrix(admin.cookie, next, true);
    expect(ok.status).toBe(200);
    expect(ok.json.added).toEqual(["NURSE:consult.read"]);
    // 이미 로그인해 있던 간호의 다음 요청부터 바로 반영
    expect(await consultCode(nurse.cookie)).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "JOB_PERMISSIONS_UPDATE", result: "SUCCESS" } });
    expect(audit.staffId).toBe(admin.staff.id);
    expect(audit.detail).toMatchObject({ added: "NURSE:consult.read", addedCount: 1, removedCount: 0 });
    expect(await db.auditLog.count({ where: { action: "JOB_PERMISSIONS_UPDATE", result: "FAILED" } })).toBe(1);
  });

  it("민감하지 않은 권한은 확인 없이 켜고, 끌 때도 확인이 필요 없다. 끄면 바로 403", async () => {
    const admin = await loginAs("ADMIN");
    const front = await loginAs("FRONT");
    const next = initial();
    next.FRONT.push("stats.read");
    expect((await putMatrix(admin.cookie, next)).status).toBe(200);
    expect(await statsCode(front.cookie)).toBe(200);
    next.COUNSELOR = next.COUNSELOR.filter((p) => p !== "consult.read"); // 민감 권한 끄기
    next.FRONT = next.FRONT.filter((p) => p !== "stats.read");
    const res = await putMatrix(admin.cookie, next);
    expect(res.status).toBe(200);
    expect(res.json.removed).toEqual(["FRONT:stats.read", "COUNSELOR:consult.read"]);
    expect(await statsCode(front.cookie)).toBe(403);
  });

  it("권한 관리 권한을 가진 활성 직원이 0명이 되면 409로 되돌린다. 다른 사람이 추가 권한으로 갖고 있으면 된다", async () => {
    const admin = await loginAs("ADMIN");
    const next = initial();
    next.ADMIN = next.ADMIN.filter((p) => p !== "staff.manage");
    const refused = await putMatrix(admin.cookie, next);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("LAST_PERMISSION_MANAGER");
    expect(await db.jobPermission.count({ where: { role: "ADMIN", permission: "staff.manage" } })).toBe(1);

    await loginAs("FRONT", { extraPermissions: ["staff.manage"] });
    expect((await putMatrix(admin.cookie, next)).status).toBe(200);
  });

  it("없는 권한 이름(예: 감사 로그 삭제)은 줄 수 없고, 다섯 직무를 모두 보내야 한다", async () => {
    const admin = await loginAs("ADMIN");
    for (const bad of ["audit.delete", "audit_log.write", "visit_status_log.delete"]) {
      const next = initial();
      next.ADMIN.push(bad);
      const res = await putMatrix(admin.cookie, next, true);
      expect(res.status, bad).toBe(400);
      expect(res.json.error.code, bad).toBe("UNKNOWN_PERMISSION");
    }
    const missing = initial();
    delete missing.NURSE;
    expect((await putMatrix(admin.cookie, missing)).status).toBe(400);
    expect(PERMISSION_NAMES.some((p) => /audit|log/.test(p))).toBe(false);
  });
});

describe("개인 추가 권한 (PATCH /api/staff/[id] extraPermissions)", () => {
  it("민감 권한은 확인이 있어야 주고, 주면 그 직원의 다음 요청부터 바로 반영, 빼면 바로 403. 감사 로그에 준·뺀 권한", async () => {
    const admin = await loginAs("ADMIN");
    const front = await loginAs("FRONT");
    const refused = await patch(admin.cookie, front.staff.id, { extraPermissions: ["consult.read"] });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("SENSITIVE_CONFIRM_REQUIRED");
    expect((await db.staff.findUniqueOrThrow({ where: { id: front.staff.id } })).extraPermissions).toEqual([]);

    expect((await patch(admin.cookie, front.staff.id, { extraPermissions: ["consult.read", "stats.read"], confirmSensitive: true })).status).toBe(200);
    expect(await consultCode(front.cookie)).toBe(200);
    expect((await callRoute(meRoute, { cookie: front.cookie })).json.navSections).toContain("consult");
    const added = await db.auditLog.findFirstOrThrow({ where: { action: "STAFF_UPDATE", result: "SUCCESS" }, orderBy: { createdAt: "desc" } });
    expect(added.detail).toMatchObject({ targetStaffId: front.staff.id, addedExtras: "stats.read,consult.read" });

    expect((await patch(admin.cookie, front.staff.id, { extraPermissions: ["stats.read"] })).status).toBe(200);
    expect(await consultCode(front.cookie)).toBe(403);
    const removed = await db.auditLog.findFirstOrThrow({ where: { action: "STAFF_UPDATE", result: "SUCCESS" }, orderBy: { createdAt: "desc" } });
    expect(removed.detail).toMatchObject({ removedExtras: "consult.read" });

    const list = await callRoute(accountsRoute, { url: "/api/staff/accounts", cookie: admin.cookie });
    expect(list.json.staff.find((s: { id: string }) => s.id === front.staff.id).extraPermissions).toEqual(["stats.read"]);
  });

  it("없는 권한 이름은 400, 자기 계정의 추가 권한은 바꿀 수 없다", async () => {
    const admin = await loginAs("ADMIN");
    const front = await loginAs("FRONT");
    expect((await patch(admin.cookie, front.staff.id, { extraPermissions: ["audit.delete"] })).status).toBe(400);
    const self = await patch(admin.cookie, admin.staff.id, { extraPermissions: ["stats.read"] });
    expect(self.status).toBe(409);
    expect(self.json.error.code).toBe("CANNOT_CHANGE_SELF");
  });

  it("권한 관리 권한도 민감 권한이다. 받은 사람은 바로 권한을 편집할 수 있고, 권한이 없는 사람은 403", async () => {
    const admin = await loginAs("ADMIN");
    const front = await loginAs("FRONT");
    const counselor = await loginAs("COUNSELOR");
    expect((await patch(front.cookie, counselor.staff.id, { extraPermissions: ["stats.read"] })).status).toBe(403);
    expect((await patch(admin.cookie, front.staff.id, { extraPermissions: ["staff.manage"] })).json.error.code).toBe("SENSITIVE_CONFIRM_REQUIRED");
    expect((await patch(admin.cookie, front.staff.id, { extraPermissions: ["staff.manage"], confirmSensitive: true })).status).toBe(200);
    expect((await patch(front.cookie, counselor.staff.id, { extraPermissions: ["stats.read"] })).status).toBe(200);
    // 자기 권한은 못 바꾸므로, 권한 관리자가 자기 권한을 빼서 0명이 되는 일은 없다. 다른 관리자를 비활성화하는 것은 된다
    expect((await patch(front.cookie, admin.staff.id, { isActive: false })).status).toBe(200);
    expect((await patch(front.cookie, front.staff.id, { extraPermissions: [] })).json.error.code).toBe("CANNOT_CHANGE_SELF");
  });
});

describe("직무 변경 때 추가 권한 다시 확인", () => {
  it("추가 권한이 있는 직원의 직무만 바꾸면 409(바뀌지 않음). 지우기([]) 또는 유지(목록)를 같이 보내야 한다", async () => {
    const admin = await loginAs("ADMIN");
    const doctor = await loginAs("DOCTOR"); // 원장: 통계·상담·금액 추가 권한
    const refused = await patch(admin.cookie, doctor.staff.id, { role: "NURSE" });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("EXTRAS_RECONFIRM_REQUIRED");
    expect(refused.json.error.extraPermissions).toEqual(["appointment.price", "stats.read", "consult.read"]);
    expect((await db.staff.findUniqueOrThrow({ where: { id: doctor.staff.id } })).role).toBe("DOCTOR");

    // 지우고 바꾸기
    expect((await patch(admin.cookie, doctor.staff.id, { role: "NURSE", extraPermissions: [] })).status).toBe(200);
    const after = await db.staff.findUniqueOrThrow({ where: { id: doctor.staff.id } });
    expect(after).toMatchObject({ role: "NURSE", extraPermissions: [] });
    expect(await statsCode(doctor.cookie)).toBe(403);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "STAFF_UPDATE", result: "SUCCESS" }, orderBy: { createdAt: "desc" } });
    expect(audit.detail).toMatchObject({ fromRole: "DOCTOR", toRole: "NURSE", removedExtras: "appointment.price,stats.read,consult.read" });
  });

  it("유지하고 바꾸기(민감 권한을 그대로 두는 것은 새로 주는 것이 아니라 확인 창 없이), 추가 권한이 없으면 그냥 바뀐다", async () => {
    const admin = await loginAs("ADMIN");
    const doctor = await loginAs("DOCTOR");
    const keep = ["appointment.price", "stats.read", "consult.read"];
    expect((await patch(admin.cookie, doctor.staff.id, { role: "COUNSELOR", extraPermissions: keep })).status).toBe(200);
    expect(await db.staff.findUniqueOrThrow({ where: { id: doctor.staff.id } })).toMatchObject({ role: "COUNSELOR", extraPermissions: keep });
    const front = await loginAs("FRONT");
    expect((await patch(admin.cookie, front.staff.id, { role: "NURSE" })).status).toBe(200);
  });
});
