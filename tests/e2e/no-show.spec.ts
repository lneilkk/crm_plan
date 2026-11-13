import { expect, test } from "@playwright/test";
import { apiAs, boardRow, createAppointmentAt, createPatient, hasRoomInDay, login, nowSlot, slotsBackFrom } from "./support";

/** 기본 노쇼 유예시간(분) — 시드의 병원 기본 설정 */
const GRACE_MIN = 30;

test.describe("노쇼", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 유예시간이 지난 오늘 예약을 만들 수 없다");

  test("유예시간이 지난 줄은 [노쇼] → 연락두절로 노쇼가 되고, 유예시간 전인 줄은 [노쇼]가 꺼져 있다", async ({ page }) => {
    const api = await apiAs("front1");
    const overdue = await createPatient(api);
    const recent = await createPatient(api);
    // 유예시간이 지난 예약(시작 + 30분 < 지금)과, 시작은 했지만 유예시간 전인 예약(시작 5~20분 전)
    const overdueAppointment = await createAppointmentAt(api, overdue.id, slotsBackFrom(nowSlot() - GRACE_MIN - 10, 24));
    const recentAppointment = await createAppointmentAt(api, recent.id, slotsBackFrom(nowSlot() - 5, 4));
    await api.dispose();

    await login(page, "front1");

    const recentRow = boardRow(page, recentAppointment.id);
    await expect(recentRow).toBeVisible();
    const recentNoShow = recentRow.getByRole("button", { name: "노쇼" });
    await expect(recentNoShow).toBeDisabled();
    await expect(recentRow).toContainText("부터 가능");

    const row = boardRow(page, overdueAppointment.id);
    await expect(row).toHaveAttribute("aria-label", /유예시간 지남/);
    await row.getByRole("button", { name: "노쇼" }).click();
    const dialog = page.getByRole("dialog", { name: /노쇼 사유/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "연락두절" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "처리됨" })).toContainText(`${overdue.nameMasked} 노쇼 처리됨`);
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${overdueAppointment.time} \\S+ 노쇼`));

    await page.reload();
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${overdueAppointment.time} \\S+ 노쇼`));
    await expect(recentRow.getByRole("button", { name: "노쇼" })).toBeDisabled();
  });
});
