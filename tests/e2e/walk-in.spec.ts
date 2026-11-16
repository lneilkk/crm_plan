import { expect, test } from "@playwright/test";
import { maskName } from "@/lib/masking";
import { apiAs, chairCodes, expectClinicOpenToday, fakeName, fakePhone, hasRoomInDay, isOccupied, login, nowSlot, summaryCount, todayAppointments } from "./support";

/**
 * T5-5 — 워크인 등록: 예약 없이 온 고객을 신규 등록해 바로 내원 처리. 보드에 '워크인' 채널·내원으로 보인다.
 * (통계의 워크인 채널 집계는 tests/integration/walk-in.test.ts)
 */
test.describe("워크인 등록", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 '지금 시각' 예약을 만들 수 없다");

  test("프론트가 [워크인 등록]에서 새 고객을 등록하고 [내원 처리]하면 보드에 워크인·내원으로 생긴다", async ({ page }) => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    // 이 시나리오 전용 체어 E5(support.ts RESERVED_CHAIRS) — 다른 시나리오가 '지금' 자리를 먼저 채우지 않는다
    const chair = "E5";
    expect(await chairCodes(api)).toContain(chair);
    expect(isOccupied(await todayAppointments(api), chair, nowSlot(), nowSlot() + 30), "E5가 지금 비어 있음").toBe(false);
    await api.dispose();

    await login(page, "front1");
    const arrivedBefore = await summaryCount(page, "내원");
    await page.getByRole("button", { name: "워크인 등록" }).click();
    const dialog = page.getByRole("dialog", { name: "워크인 등록" });
    const name = fakeName();
    await dialog.getByRole("button", { name: "신규 고객 등록" }).click();
    await dialog.getByLabel("이름").fill(name);
    await dialog.getByLabel("휴대폰").fill(fakePhone());
    await dialog.getByRole("button", { name: "고객 등록 후 선택" }).click();
    const duplicate = dialog.getByRole("button", { name: "다른 사람입니다 — 새로 등록" });
    const selected = dialog.getByText(maskName(name));
    await expect(selected.or(duplicate).first()).toBeVisible();
    if (await duplicate.isVisible()) await duplicate.click();
    await dialog.getByLabel("체어").selectOption(chair!);
    await dialog.getByLabel("예약 항목").selectOption("정기검진");
    await dialog.getByRole("button", { name: "내원 처리" }).click();
    await expect(page.getByRole("status").filter({ hasText: "워크인 내원 처리했습니다." })).toBeVisible();
    await expect(dialog).toHaveCount(0);

    const row = page.locator('[data-testid="board-row"]').filter({ hasText: maskName(name) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("워크인");
    await expect(row).toHaveAttribute("aria-label", / 내원$/);
    await expect.poll(() => summaryCount(page, "내원")).toBe(arrivedBefore + 1);
  });

  test("간호(예약 쓰기 없음)·원장에게는 [워크인 등록]이 없다", async ({ browser }) => {
    for (const loginId of ["nurse1", "doctor1"] as const) {
      const page = await (await browser.newContext()).newPage();
      await login(page, loginId);
      await page.goto("/board");
      await expect(page.getByRole("heading", { name: /내원 보드/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "워크인 등록" })).toHaveCount(0);
      await page.context().close();
    }
  });
});
