import { expect, test } from "@playwright/test";
import { apiAs, boardRow, createAppointmentAt, createPatient, expectClinicOpenToday, hasRoomInDay, login, nowSlot, slotsBackFrom } from "./support";

/**
 * T5-4 — 미확인 강조와 자동 갱신.
 * - 예약 시각이 지났는데 결과가 없으면 주황(미확인), 노쇼 유예시간까지 지나면 빨강 + 상단 알림.
 * - 완료 기준: 다른 PC에서 바꾼 상태가 10초 이내 반영(새로고침 없이).
 */
const GRACE_MIN = 30; // 기본 노쇼 유예시간
/**
 * '방금 지난' 자리는 체어마다 몇 칸뿐이라 다른 시나리오(no-show·undo 등)와 겹치지 않게
 * 이 시나리오 전용 체어 E4(scripts/e2e/setup-db.ts)에 5분짜리 예약만 만든다.
 */
const SHORT = { durationMin: 5, isFree: (chair: string) => chair === "E4" };

test.describe("미확인 강조와 자동 갱신", () => {
  test.skip(!hasRoomInDay() || nowSlot() < GRACE_MIN + 60, "자정 앞뒤·이른 새벽에는 '지난 오늘 예약'을 만들 수 없다");

  test("예약 시각이 지난 줄은 주황(미확인), 유예시간이 지난 줄은 빨강이고 상단 알림이 뜬다", async ({ page }) => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    const orangeAt = await createAppointmentAt(api, (await createPatient(api)).id, slotsBackFrom(nowSlot() - 5, 4), SHORT);
    const redAt = await createAppointmentAt(api, (await createPatient(api)).id, slotsBackFrom(nowSlot() - GRACE_MIN - 10, 24), SHORT);
    await api.dispose();

    await login(page, "front1");
    const orange = boardRow(page, orangeAt.id);
    await expect(orange).toHaveAttribute("aria-label", /예약 시각 지남/);
    await expect(orange).toContainText("미확인");
    await expect(orange).toHaveClass(/bg-orange-50/);
    const red = boardRow(page, redAt.id);
    await expect(red).toHaveAttribute("aria-label", /유예시간 지남/);
    await expect(red).toHaveClass(/bg-red-50/);
    await expect(page.getByRole("alert").filter({ hasText: "노쇼 유예시간이 지났는데 결과가 입력되지 않은 예약이" })).toBeVisible();
  });

  test("다른 PC에서 [내원]을 누르면 이 PC의 보드에 새로고침 없이 10초 안에 반영된다", async ({ browser }) => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    const appointment = await createAppointmentAt(api, (await createPatient(api)).id, slotsBackFrom(nowSlot() - 5, 4), SHORT);
    await api.dispose();

    const watcher = await (await browser.newContext()).newPage(); // 이 PC — 보기만 한다
    await login(watcher, "counselor1");
    await watcher.goto("/board");
    const watched = boardRow(watcher, appointment.id);
    await expect(watched).toHaveAttribute("aria-label", /예약 시각 지남/);

    const other = await (await browser.newContext()).newPage(); // 다른 PC
    await login(other, "front1");
    await boardRow(other, appointment.id).getByRole("button", { name: "내원" }).click();
    await expect(other.getByRole("status").filter({ hasText: "처리됨" })).toBeVisible();
    const savedAt = Date.now();

    await expect(watched).toHaveAttribute("aria-label", new RegExp(`^${appointment.time} \\S+ (내원|지각내원)`), { timeout: 10_000 });
    const elapsed = Date.now() - savedAt;
    expect(elapsed, `반영까지 ${elapsed}ms`).toBeLessThanOrEqual(10_000);
    await expect(watched).not.toHaveClass(/bg-orange-50/);
    await other.context().close();
    await watcher.context().close();
  });
});
