import { expect, test } from "@playwright/test";
import { apiAs, createAppointmentAt, createPatient, hasRoomInDay, login, nowSlot, slotsBackFrom } from "./support";

test.describe("권한", () => {
  test("프론트가 통계 화면을 열면 권한 없음 안내만 보인다", async ({ page }) => {
    await login(page, "front1");
    await page.goto("/stats");
    await expect(page.getByRole("alert").filter({ hasText: "이 화면을 볼 권한이 없습니다" })).toContainText("통계·실적 보기");
    await expect(page.getByRole("heading", { name: "내원 통계" })).toHaveCount(0);
    await expect(page.getByText("실내원율")).toHaveCount(0);
  });

  test("원장(의사)은 통계 대시보드에서 숫자를 보고, 환자 이름·번호는 어디에도 없다", async ({ page }) => {
    test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 오늘 예약을 만들 수 없다");
    // 오늘 내원한 고객 한 명을 만들어 두고, 그 이름이 통계 화면에 나오지 않는지 본다
    const api = await apiAs("front1");
    const patient = await createPatient(api);
    const appointment = await createAppointmentAt(api, patient.id, slotsBackFrom(nowSlot() - 5, 24));
    const arrived = await api.post(`/api/appointments/${appointment.id}/status`, {
      data: { to: "ARRIVED", reasonCode: null, expectedStatus: "BOOKED" },
    });
    expect(arrived.ok()).toBeTruthy();
    await api.dispose();

    await login(page, "doctor1");
    await expect(page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "통계" })).toBeVisible();
    await page.goto("/stats");
    await expect(page.getByRole("heading", { name: "내원 통계" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "실내원율" }).first()).toBeVisible();
    await expect(page.getByText(/^내원 \d+ \/ 유효 예약 [1-9]\d*$/)).toBeVisible();
    await expect(page.getByText(/^\d+(\.\d+)?%$/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "구간별 표" })).toBeVisible();

    const text = await page.locator("main").innerText();
    expect(text).not.toContain(patient.name);
    expect(text).not.toContain(patient.nameMasked);
    expect(text).not.toMatch(/01[016789]-?[\d*]{3,4}-?\d{4}/);
  });
});
