import { expect, test } from "@playwright/test";
import { apiAs, boardRow, createAppointmentAt, createPatient, hasRoomInDay, login, nowSlot, slotsBackFrom } from "./support";

test.describe("되돌리기", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 '오늘 이미 시작한 예약'을 만들 수 없다");

  test("[내원]을 누르고 5초 안에 되돌리기를 누르면 그 줄이 원래 상태(예약확정)로 돌아간다", async ({ page }) => {
    const api = await apiAs("front1");
    const patient = await createPatient(api);
    const appointment = await createAppointmentAt(api, patient.id, slotsBackFrom(nowSlot() - 5, 12));
    await api.dispose();

    await login(page, "front1");
    const row = boardRow(page, appointment.id);
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${appointment.time} \\S+ 예약확정`));

    await row.getByRole("button", { name: "내원", exact: true }).click();
    const toast = page.getByRole("status").filter({ hasText: "처리됨" });
    await expect(toast).toContainText(patient.nameMasked);
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${appointment.time} \\S+ (지각내원|내원)`));

    await toast.getByRole("button", { name: /되돌리기/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "되돌렸습니다" })).toContainText(`${patient.nameMasked} 예약확정`);
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${appointment.time} \\S+ 예약확정`));
    await expect(row.getByRole("button", { name: "내원", exact: true })).toBeEnabled();

    // 새로 읽어도 원래 상태다(저장된 값)
    await page.reload();
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${appointment.time} \\S+ 예약확정`));
  });
});
