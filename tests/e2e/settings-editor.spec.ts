import { expect, test } from "@playwright/test";
import { addDays, kstDateTime } from "@/lib/time/kst";
import { apiAs, createPatient, login, todayKey } from "./support";

// F-14 [편집] 탭: 하위 메뉴, 직원 추가(간호), 체어 묶음 이름이 캘린더 열 위에 보임
test("관리자는 [편집]에서 간호 직원을 추가하고, 체어에 묶음 이름을 붙이면 캘린더 열 위에 보인다", async ({ page }) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  await login(page, "admin");
  await page.goto("/calendar");
  await page.getByRole("group", { name: "화면" }).getByRole("button", { name: "편집" }).click();
  const menu = page.getByRole("navigation", { name: "편집 메뉴" });

  // 직원 추가
  await menu.getByRole("button", { name: "직원" }).click();
  const add = page.getByRole("form", { name: "직원 추가" });
  await add.getByLabel("새 직원 이름").fill("가상간호");
  await add.getByLabel("새 직원 아이디").fill(`nurse${suffix}`);
  await add.getByLabel("새 직원 역할").selectOption("NURSE");
  await add.getByLabel("새 직원 첫 비밀번호").fill(`Nurse-${suffix}-01`);
  await add.getByRole("button", { name: "+ 직원 추가" }).click();
  await expect(page.getByRole("status").filter({ hasText: "직원을 추가했습니다." })).toBeVisible();
  const row = page.getByRole("row", { name: `직원 nurse${suffix}` });
  await expect(row).toBeVisible();
  await expect(row.getByLabel(`nurse${suffix} 역할`)).toHaveValue("NURSE");

  // 체어 묶음
  await menu.getByRole("button", { name: "체어·열" }).click();
  await page.getByLabel("열 1 묶음").fill("보철과");
  await page.getByRole("button", { name: "체어·열 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "체어·열을 저장했습니다." })).toBeVisible();

  await page.getByRole("group", { name: "화면" }).getByRole("button", { name: "캘린더" }).click();
  await expect(page.getByText("보철과", { exact: true }).first()).toBeVisible();
});

// S-3 보완: 단가를 비우면 "단가 미입력"으로 표시된다(0원과 구분). 저장하지 않고 화면 표시만 본다(공유 E2E DB를 바꾸지 않음).
test("관리자가 [예약 항목]에서 단가를 비우면 '단가 미입력' 표시가 뜬다", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/calendar");
  await page.getByRole("group", { name: "화면" }).getByRole("button", { name: "편집" }).click();
  await page.getByRole("navigation", { name: "편집 메뉴" }).getByRole("button", { name: "예약 항목" }).click();
  const price = page.getByLabel("보철 단가(원)");
  await expect(price).not.toHaveValue("");
  await expect(page.getByText("단가 미입력", { exact: true })).toHaveCount(0);
  await price.fill("");
  await expect(page.getByText("단가 미입력", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "단가 미입력 1개: 보철" })).toBeVisible();
});

// S-3 보완: 빠진 단가를 채우면 "단가 없이 잡힌 예약 N건에도 적용" 확인을 받고, 확인하면 그 예약에 단가가 들어간다.
// 끝나면 보철 단가는 원래 값으로 돌아간다(공유 E2E DB).
test("빠진 단가를 채우면 적용 건수를 확인받고, 확인하면 단가 없이 잡힌 예약에 들어간다", async ({ page }) => {
  const admin = await apiAs("admin");
  const settings = (await (await admin.get("/api/settings")).json()) as {
    treatmentItems: string[];
    treatmentItemMeta: Record<string, { category: string; price: number | null; color?: string }>;
  };
  const original = settings.treatmentItemMeta["보철"].price as number;
  const items = (priceOf: (name: string) => number | null) =>
    settings.treatmentItems.map((name) => ({ name, category: settings.treatmentItemMeta[name].category, price: priceOf(name), color: settings.treatmentItemMeta[name].color }));
  expect((await admin.put("/api/settings/treatment-items", { data: { items: items((n) => (n === "보철" ? null : settings.treatmentItemMeta[n].price)) } })).ok()).toBeTruthy();

  const front = await apiAs("front1");
  const patient = await createPatient(front);
  const day = addDays(todayKey(), 40);
  const created = await front.post("/api/appointments", {
    data: { patientId: patient.id, startAt: kstDateTime(day, "10:00").toISOString(), durationMin: 30, chair: "E3", treatmentItem: "보철", channel: "PHONE" },
  });
  expect(created.status()).toBe(201);
  const appointmentId = ((await created.json()) as { appointment: { id: string } }).appointment.id;
  await front.dispose();

  await login(page, "admin");
  await page.goto("/calendar");
  await page.getByRole("group", { name: "화면" }).getByRole("button", { name: "편집" }).click();
  await page.getByRole("navigation", { name: "편집 메뉴" }).getByRole("button", { name: "예약 항목" }).click();
  await page.getByLabel("보철 단가(원)").fill(String(original));
  await page.getByRole("button", { name: "예약 항목 저장" }).click();
  const confirm = page.getByRole("alertdialog", { name: "단가 적용 확인" });
  await expect(confirm).toContainText("단가 없이 잡힌 예약 1건에도 이 단가가 적용됩니다");
  await expect(confirm).toContainText("보철: 1건");
  await confirm.getByRole("button", { name: "적용하고 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "예약 항목을 저장했습니다." })).toBeVisible();

  const detail = (await (await admin.get(`/api/appointments/${appointmentId}`)).json()) as { appointment: { listPrice: number | null } };
  expect(detail.appointment.listPrice).toBe(original);
  const after = (await (await admin.get("/api/settings")).json()) as { treatmentItemMeta: Record<string, { price: number | null }> };
  expect(after.treatmentItemMeta["보철"].price).toBe(original);
  await admin.dispose();
});
