import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { apiAs, login } from "./support";

/**
 * 확장 계획 S-7 — [편집] → [권한](직무 × 권한 표)과 [직원]의 추가 권한.
 * - 민감 권한을 줄 때 확인 창, 취소하면 아무것도 바뀌지 않음.
 * - 바꾸면 그 직원 화면에 바로 반영(새로고침 없이 화면만 옮겨도 메뉴가 맞춰짐).
 * - 추가 권한이 있는 직원의 직무를 바꾸면 지울지 유지할지 먼저 고른다.
 * 시나리오가 바꾼 권한은 끝에서 되돌린다(다른 시나리오가 첫 설치 값을 기대한다).
 */

async function openEditor(page: Page, section: string) {
  await page.goto("/calendar");
  await page.getByRole("group", { name: "화면" }).getByRole("button", { name: "편집" }).click();
  await page.getByRole("navigation", { name: "편집 메뉴" }).getByRole("button", { name: section }).click();
}

const menuOf = (page: Page) => page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link");

test("직무 × 권한 표: 간호에게 상담 보기(민감)를 주면 확인 창을 거쳐 저장되고, 간호 메뉴에 [상담]이 생긴다", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, "admin");
  await openEditor(admin, "권한");
  const table = admin.getByRole("table", { name: "직무별 권한" });
  const cell = table.getByRole("checkbox", { name: "간호 — 상담 보기" });
  await expect(cell).not.toBeChecked();
  await cell.check();
  await expect(admin.getByText("바뀐 칸 1개")).toBeVisible();
  await admin.getByRole("button", { name: "권한 저장" }).click();
  const confirm = admin.getByRole("alertdialog", { name: "민감 권한 확인" });
  await expect(confirm).toContainText("간호 — 상담 보기");
  // 취소하면 저장되지 않는다
  await confirm.getByRole("button", { name: "취소" }).click();
  const api = await apiAs("admin");
  const before = (await (await api.get("/api/staff/job-permissions")).json()) as { jobPermissions: Record<string, string[]> };
  expect(before.jobPermissions.NURSE).not.toContain("consult.read");

  await admin.getByRole("button", { name: "권한 저장" }).click();
  await admin.getByRole("alertdialog", { name: "민감 권한 확인" }).getByRole("button", { name: "주고 저장" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "직무별 권한을 저장했습니다." })).toBeVisible();

  const nurse = await (await browser.newContext()).newPage();
  await login(nurse, "nurse1");
  await expect(menuOf(nurse)).toHaveText(["내원 보드", "예약 캘린더", "상담", "고객"]);
  await nurse.context().close();

  // 되돌리기(민감 권한을 끄는 것은 확인 없이)
  await openEditor(admin, "권한");
  await admin.getByRole("table", { name: "직무별 권한" }).getByRole("checkbox", { name: "간호 — 상담 보기" }).uncheck();
  await admin.getByRole("button", { name: "권한 저장" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "직무별 권한을 저장했습니다." })).toBeVisible();
  const after = (await (await api.get("/api/staff/job-permissions")).json()) as { jobPermissions: Record<string, string[]> };
  expect(after.jobPermissions.NURSE).not.toContain("consult.read");
  await api.dispose();
  await admin.context().close();
});

test("권한을 빼면 이미 로그인한 직원의 화면에도 새로고침 없이 반영된다", async ({ page }) => {
  const api = await apiAs("admin");
  const accounts = (await (await api.get("/api/staff/accounts")).json()) as { staff: { id: string; loginId: string; extraPermissions: string[] }[] };
  const doctor = accounts.staff.find((s) => s.loginId === "doctor1")!;
  await login(page, "doctor1");
  await expect(menuOf(page)).toHaveText(["내원 보드", "예약 캘린더", "상담", "고객", "통계"]);

  const without = doctor.extraPermissions.filter((p) => p !== "stats.read");
  expect((await api.patch(`/api/staff/${doctor.id}`, { data: { extraPermissions: without } })).status()).toBe(200);
  // 메뉴를 눌러 화면만 옮긴다(새로고침 없음) — 내 권한을 다시 읽어 [통계]가 사라진다
  await menuOf(page).filter({ hasText: "고객" }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await expect(menuOf(page)).toHaveText(["내원 보드", "예약 캘린더", "상담", "고객"]);
  // 열어 둔 주소로 가도 권한 없음 안내만
  await page.goto("/stats");
  await expect(page.getByRole("alert").filter({ hasText: "이 화면을 볼 권한이 없습니다" })).toBeVisible();

  expect((await api.patch(`/api/staff/${doctor.id}`, { data: { extraPermissions: doctor.extraPermissions } })).status()).toBe(200);
  await api.dispose();
});

test("[직원]: 추가 권한(민감 권한은 확인), 추가 권한이 있는 직원의 직무를 바꾸면 지울지 유지할지 먼저 고른다", async ({ page }) => {
  const api = await apiAs("admin");
  const loginId = `s7-${randomBytes(3).toString("hex")}`;
  const created = await api.post("/api/staff", { data: { loginId, name: "가상프론트", role: "FRONT", password: `Aa1!${randomBytes(9).toString("base64url")}` } });
  expect(created.status()).toBe(201);
  await api.dispose();

  await login(page, "admin");
  await openEditor(page, "직원");
  const row = page.getByRole("row", { name: `직원 ${loginId}` });
  await expect(row).toContainText("없음");
  await row.getByRole("button", { name: "추가 권한" }).click();
  const extras = page.getByRole("group", { name: `${loginId} 추가 권한` });
  await expect(extras.getByRole("checkbox", { name: /고객 보기/ })).toBeDisabled(); // 직무에 있음
  await extras.getByRole("checkbox", { name: /^통계·실적 보기/ }).check();
  await extras.getByRole("checkbox", { name: /^상담 보기/ }).check();
  await extras.getByRole("button", { name: "추가 권한 저장" }).click();
  const confirm = page.getByRole("alertdialog", { name: "민감 권한 확인" });
  await expect(confirm).toContainText("상담 보기");
  await confirm.getByRole("button", { name: "주고 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "직원 정보를 저장했습니다." })).toBeVisible();
  await expect(row).toContainText("통계·실적 보기");
  await expect(row).toContainText("상담 보기");

  // 직무를 간호로 바꾸려 하면 추가 권한을 어떻게 할지 먼저 묻는다
  await row.getByRole("combobox", { name: `${loginId} 역할` }).selectOption("NURSE");
  await row.getByRole("button", { name: "저장" }).click();
  const reconfirm = page.getByRole("alertdialog", { name: `${loginId} 직무 변경 확인` });
  await expect(reconfirm).toContainText("추가 권한 2개");
  await reconfirm.getByRole("button", { name: "추가 권한 지우고 바꾸기" }).click();
  await expect(page.getByRole("status").filter({ hasText: "직원 정보를 저장했습니다." })).toBeVisible();
  await expect(row.getByRole("combobox", { name: `${loginId} 역할` })).toHaveValue("NURSE");
  await expect(row).toContainText("없음");
});
