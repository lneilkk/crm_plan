import { expect, test } from "@playwright/test";
import { login } from "./support";

test.describe("로그인", () => {
  test("틀린 비밀번호는 오류를 보이고, 프론트는 내원 보드로 들어가 메뉴에 통계가 없으며, 로그아웃하면 로그인 화면으로 간다", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("아이디").fill("front1");
    await page.getByLabel("비밀번호").fill("wrong-password-e2e");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(page.locator("#login-error")).not.toBeEmpty();
    await expect(page).toHaveURL(/\/login$/);

    await login(page, "front1");
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await expect(nav.getByRole("link", { name: "내원 보드" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "예약 캘린더" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "고객" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "통계" })).toHaveCount(0);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login$/);
    // 로그아웃 뒤에는 보드로 바로 들어가지 못한다
    await page.goto("/board");
    await expect(page).toHaveURL(/\/login$/);
  });
});
