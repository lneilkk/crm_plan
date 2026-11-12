import { expect, test } from "@playwright/test";
import { login } from "./support";

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
