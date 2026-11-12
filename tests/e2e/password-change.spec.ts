import { expect, type Page, request as playwrightRequest, test } from "@playwright/test";
import { BASE_URL } from "./support";

// F-1 비밀번호 변경. 다른 시나리오가 쓰지 않는 doctor2 계정으로 시험하고, 끝나면 원래 비밀번호로 되돌린다.
const LOGIN_ID = "doctor2";
const seedPw = () => process.env.SEED_STAFF_PASSWORD ?? "";
// 실행마다 다른 새 비밀번호(규칙: 3종류 이상, 8자 이상)
const newPw = `Chg-${Math.random().toString(36).slice(2, 10)}-9`;

async function loginWith(page: Page, pw: string) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill(LOGIN_ID);
  await page.getByLabel("비밀번호").fill(pw);
  await page.getByRole("button", { name: "로그인" }).click();
}

test.describe("비밀번호 변경", () => {
  test.afterAll(async () => {
    // 바꾼 비밀번호를 시드 비밀번호로 되돌린다(이미 되돌렸거나 바꾸지 못했으면 아무것도 하지 않음).
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const res = await api.post("/api/auth/login", { data: { loginId: LOGIN_ID, password: newPw } });
    if (res.ok()) {
      const back = await api.post("/api/auth/password", { data: { currentPassword: newPw, newPassword: seedPw() } });
      expect(back.ok(), "시드 비밀번호로 되돌리기").toBeTruthy();
    }
    await api.dispose();
  });

  test("상단 [비밀번호 변경]에서 바꾸면 새 비밀번호로만 로그인된다", async ({ page }) => {
    await loginWith(page, seedPw());
    await expect(page).toHaveURL(/\/board$/);

    await page.getByRole("link", { name: "비밀번호 변경" }).click();
    await expect(page.getByRole("heading", { name: "비밀번호 변경" })).toBeVisible();

    // 규칙에 맞지 않으면 안내가 나오고 버튼이 꺼져 있다
    await page.getByLabel("현재 비밀번호").fill(seedPw());
    await page.getByLabel("새 비밀번호", { exact: true }).fill("short1");
    await expect(page.getByText("10자 이상, 3종류 이상이면 8자 이상이어야 합니다.")).toBeVisible();
    await expect(page.getByRole("button", { name: "비밀번호 바꾸기" })).toBeDisabled();

    await page.getByLabel("새 비밀번호", { exact: true }).fill(newPw);
    await expect(page.getByText("규칙에 맞습니다.")).toBeVisible();
    await page.getByLabel("새 비밀번호 확인").fill(newPw);
    await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
    await expect(page.getByRole("status").filter({ hasText: "비밀번호를 바꿨습니다." })).toBeVisible();
    await expect(page.getByLabel("현재 비밀번호")).toHaveValue("");

    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // 옛 비밀번호로는 안 되고, 새 비밀번호로 된다
    await loginWith(page, seedPw());
    await expect(page.getByText("아이디 또는 비밀번호가 올바르지 않습니다", { exact: false })).toBeVisible();
    await loginWith(page, newPw);
    await expect(page).toHaveURL(/\/board$/);
  });
});
