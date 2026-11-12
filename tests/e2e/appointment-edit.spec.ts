import { expect, test } from "@playwright/test";
import { apiAs, createPatient, expectClinicOpenToday, hasRoomInDay, login, minutesToTime, nowSlot, todayKey } from "./support";
import { kstDateTime } from "@/lib/time/kst";

// F-5 상담실은 고가 항목만(일반으로 바뀌면 체어로), F-8 메모, F-6 실적 화면
test.describe("예약 고치기와 실적", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 '오늘 예약'을 만들 수 없다");

  test("상담실 임플란트 예약을 스케일링으로 바꾸면 진료 체어를 골라야 하고, 저장하면 체어로 옮겨진다. 메모를 저장하면 칸에 표시된다", async ({ page }) => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    const patient = await createPatient(api);
    // 상담실(R1)의 지금보다 뒤 빈 자리에 임플란트 상담 예약
    let id: string | null = null;
    for (let start = nowSlot() + 60; start + 30 <= 24 * 60 && !id; start += 30) {
      const res = await api.post("/api/appointments", {
        data: {
          patientId: patient.id,
          startAt: kstDateTime(todayKey(), minutesToTime(start)).toISOString(),
          durationMin: 30,
          chair: "R1",
          treatmentItem: "임플란트",
          channel: "PHONE",
        },
      });
      if (res.status() === 201) id = ((await res.json()) as { appointment: { id: string } }).appointment.id;
    }
    expect(id, "상담실 빈 자리").not.toBeNull();
    await api.dispose();

    await login(page, "front1");
    await page.goto("/calendar");
    const block = page.locator(`[data-appointment-id="${id}"]`);
    await block.click();
    const dialog = page.getByRole("dialog", { name: "예약 상세" });
    const form = dialog.getByRole("form", { name: "예약 고치기" });
    await form.getByLabel("예약 항목").selectOption("스케일링");
    await expect(form.getByText("일반 진료는 상담실에 둘 수 없습니다. 진료 체어를 고르세요.")).toBeVisible();
    await form.getByLabel("체어").selectOption("E1");
    await form.getByLabel("메모").fill("상담 후 스케일링으로 변경");
    await form.getByRole("button", { name: "예약 저장" }).click();
    await expect(page.getByRole("status").filter({ hasText: "예약을 저장했습니다." })).toBeVisible();
    await dialog.getByRole("button", { name: "닫기" }).click();

    await expect(block).toHaveAttribute("aria-label", /스케일링 .* 예약, 메모 있음$/);
    const check = await apiAs("front1");
    const detail = (await (await check.get(`/api/appointments/${id}`)).json()) as { appointment: { chair: string; listPrice: number } };
    expect(detail.appointment.chair).toBe("E1");
    expect(detail.appointment.listPrice).toBeGreaterThanOrEqual(0);
    await check.dispose();
  });

  test("관리자는 통계의 [실적] 탭에서 의사별·상담자별 실적을 본다", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/stats");
    await page.getByRole("group", { name: "통계 종류" }).getByRole("button", { name: "실적" }).click();
    await expect(page.getByRole("heading", { name: "진료 실적" })).toBeVisible();
    await page.getByRole("button", { name: "최근 3개월" }).click();
    await expect(page.getByRole("table", { name: "의사별 실적" })).toBeVisible();
    await expect(page.getByRole("table", { name: "의사별 실적" })).toContainText("합계");
    await expect(page.getByRole("table", { name: "상담자별 실적" })).toBeVisible();
  });
});
