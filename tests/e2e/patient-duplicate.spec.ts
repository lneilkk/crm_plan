import { expect, test } from "@playwright/test";
import { apiAs, createPatient, fakeName, login } from "./support";

test.describe("고객 중복 경고", () => {
  test("이미 있는 번호로 고객을 등록하면 중복 경고가 보이고, 그래도 등록을 누르면 새 고객이 만들어진다", async ({ page }) => {
    const api = await apiAs("front1");
    const existing = await createPatient(api);
    await api.dispose();

    await login(page, "front1");
    await page.goto("/patients/new");
    await expect(page.getByRole("heading", { name: "고객 등록" })).toBeVisible();
    let name = fakeName();
    while (name === existing.name) name = fakeName(); // 이름까지 같으면 같은 사람(구환)으로 본다(F-4)
    await page.getByLabel("이름 *").fill(name);
    await page.getByLabel("휴대폰 *").fill(existing.phone);
    await page.getByRole("button", { name: "등록", exact: true }).click();

    const warning = page.getByRole("alert").filter({ hasText: "같은 번호로 등록된 고객이 있습니다" });
    await expect(warning).toBeVisible();
    await expect(warning.getByRole("link", { name: existing.nameMasked })).toBeVisible();
    // 경고에는 마스킹한 이름만 보인다
    await expect(warning).not.toContainText(existing.name);
    await expect(page).toHaveURL(/\/patients\/new$/);

    await warning.getByRole("button", { name: "그래도 등록" }).click();
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toContain(existing.id);
  });

  test("이름과 번호가 모두 같으면 새로 만들지 않고 '이미 등록된 고객(구환)'으로 안내한다 (F-4)", async ({ page }) => {
    const api = await apiAs("front1");
    const existing = await createPatient(api);
    await api.dispose();

    await login(page, "front1");
    await page.goto("/patients/new");
    await page.getByLabel("이름 *").fill(existing.name);
    await page.getByLabel("휴대폰 *").fill(existing.phone);
    await page.getByRole("button", { name: "등록", exact: true }).click();

    const notice = page.getByRole("alert").filter({ hasText: "이미 등록된 고객입니다 (구환)" });
    await expect(notice).toBeVisible();
    await notice.getByRole("link", { name: /고객 상세 보기/ }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${existing.id}$`));
  });
});
