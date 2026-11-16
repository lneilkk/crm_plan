import { expect, test } from "@playwright/test";
import { apiAs, createAppointmentAt, createPatient, expectClinicOpenToday, isOccupied, login, minutesToTime, todayAppointments } from "./support";

/** 일 보기: 분당 2px → 60분 = 120px (src/components/calendar/day-view.tsx PX_PER_MIN) */
const PX_PER_MIN = 2;
const MOVE_MIN = 60;

test.describe("캘린더 드래그", () => {
  test("대기 중인 예약 블록을 일 보기에서 1시간 아래 빈 칸으로 끌면 새 시각이 저장되어 새로 고침 뒤에도 남는다", async ({ page }) => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    const patient = await createPatient(api);
    const items = await todayAppointments(api);
    // 진료시간(09:30~18:30) 안에서, 옮길 자리(1시간 뒤 30분)도 비어 있는 체어를 고른다. 화면 위쪽부터.
    const starts = Array.from({ length: 14 }, (_, i) => 9 * 60 + 30 + i * 30);
    const appointment = await createAppointmentAt(api, patient.id, starts, {
      isFree: (chair, start) => !isOccupied(items, chair, start + MOVE_MIN, start + MOVE_MIN + 30),
    });
    await api.dispose();
    const newTime = minutesToTime(appointment.start + MOVE_MIN);

    await login(page, "front1");
    await page.goto("/calendar");
    const block = page.getByRole("button", { name: `${appointment.time} ${patient.nameMasked} 정기검진 예약확정 예약` });
    await expect(block).toBeVisible();
    await block.scrollIntoViewIfNeeded();
    const box = (await block.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 10;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 10, { steps: 2 });
    await page.mouse.move(x, y + MOVE_MIN * PX_PER_MIN, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByRole("status").filter({ hasText: `${newTime}(으)로 옮겼습니다.` })).toBeVisible();
    const moved = page.getByRole("button", { name: `${newTime} ${patient.nameMasked} 정기검진 예약확정 예약` });
    await expect(moved).toBeVisible();

    await page.reload();
    await expect(moved).toBeVisible();
    await expect(block).toHaveCount(0);
  });
});
