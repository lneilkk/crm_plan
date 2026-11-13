import { expect, test } from "@playwright/test";
import { apiAs, createPatient, login, type LoginId } from "./support";

/**
 * 확장 계획 S-3 — 권한이 없는 버튼은 그리지 않는다(화면 등록부). 실제 차단은 API가 한다.
 * 고객 등록·수정(patient.write)은 프론트·상담·관리자만. 의사·간호에게는 버튼이 없다.
 */
test.describe("권한에 따라 보이는 버튼", () => {
  for (const [loginId, canWrite] of [
    ["front1", true],
    ["nurse1", false],
    ["doctor1", false],
  ] as [LoginId, boolean][]) {
    test(`${loginId}: 고객 [고객 등록]·[수정] ${canWrite ? "보임" : "안 보임"}`, async ({ page }) => {
      const api = await apiAs("front1");
      const patient = await createPatient(api);
      await api.dispose();

      await login(page, loginId);
      await page.goto("/patients");
      await expect(page.getByRole("heading", { name: "고객", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "고객 등록" })).toHaveCount(canWrite ? 1 : 0);

      await page.goto(`/patients/${patient.id}`);
      await expect(page.getByRole("heading", { name: patient.name })).toBeVisible();
      await expect(page.getByRole("button", { name: "수정", exact: true })).toHaveCount(canWrite ? 1 : 0);
    });
  }
});
