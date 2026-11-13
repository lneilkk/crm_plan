import { expect, test } from "@playwright/test";
import { apiAs, createPatient, expectClinicOpenToday, hasRoomInDay, login, minutesToTime, nowSlot, todayKey } from "./support";
import { kstDateTime } from "@/lib/time/kst";

// F-11 수술 기록: 간호가 참여 직원을 기록하고(메모는 못 봄), 원장이 수술 메모를 쓴다.
test.describe("수술 기록", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 '오늘 예약'을 만들 수 없다");

  test("간호는 참여 직원을 기록하고, 원장은 수술 메모를 쓴다", async ({ browser }) => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    const patient = await createPatient(api);
    let id: string | null = null;
    for (let start = nowSlot() + 60; start + 60 <= 24 * 60 && !id; start += 30) {
      const res = await api.post("/api/appointments", {
        data: { patientId: patient.id, startAt: kstDateTime(todayKey(), minutesToTime(start)).toISOString(), durationMin: 60, chair: "E2", treatmentItem: "임플란트", channel: "PHONE" },
      });
      if (res.status() === 201) id = ((await res.json()) as { appointment: { id: string } }).appointment.id;
    }
    expect(id, "E2 빈 자리").not.toBeNull();
    await api.dispose();

    const nursePage = await (await browser.newContext()).newPage();
    await login(nursePage, "nurse1");
    await nursePage.goto("/calendar");
    await nursePage.locator(`[data-appointment-id="${id}"]`).click();
    const dialog = nursePage.getByRole("dialog", { name: "예약 상세" });
    const section = dialog.getByRole("region", { name: "수술 기록" });
    await expect(section).toBeVisible();
    await expect(section.getByText("수술 메모", { exact: false })).toHaveCount(0); // 간호에게는 메모가 없다
    await expect(dialog.getByRole("button", { name: "고치기", exact: true })).toHaveCount(0); // 예약 수정 권한 없음
    await section.getByRole("button", { name: "참여 직원 고치기" }).click();
    const pick = section.getByRole("group", { name: "참여 직원 고르기" });
    await pick.getByRole("button", { name: /한간호/ }).click();
    await pick.getByRole("button", { name: /이의사/ }).click();
    await section.getByRole("button", { name: "참여 직원 저장" }).click();
    await expect(nursePage.getByRole("status").filter({ hasText: "참여 직원을 저장했습니다." })).toBeVisible();
    await expect(section).toContainText("한간호 (간호)");
    await expect(section).toContainText("이의사 (의사)");
    await nursePage.context().close();

    const doctorPage = await (await browser.newContext()).newPage();
    await login(doctorPage, "doctor1");
    await doctorPage.goto("/calendar");
    await doctorPage.locator(`[data-appointment-id="${id}"]`).click();
    const doctorSection = doctorPage.getByRole("dialog", { name: "예약 상세" }).getByRole("region", { name: "수술 기록" });
    await doctorSection.getByLabel(/수술 메모/).fill("시험 메모: 기구 준비 늦음");
    await doctorSection.getByRole("button", { name: "수술 메모 저장" }).click();
    await expect(doctorPage.getByRole("status").filter({ hasText: "수술 메모를 저장했습니다." })).toBeVisible();
    await expect(doctorSection).toContainText("이의사");
    await doctorPage.context().close();
  });
});
