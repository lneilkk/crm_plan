import { expect, type Page, test } from "@playwright/test";
import { addDays, kstDateTime } from "@/lib/time/kst";
import { apiAs, createPatient, login, todayKey } from "./support";

/**
 * T4-3 — 예약 변경·취소. 앞날 예약은 캘린더의 예약 상세에서 [예약변경]·[취소]를 한다(내원 보드는 오늘만).
 * 완료 기준: 변경 이력을 고객 상세에서 추적 — 원 예약 → 새 예약(사전취소)이 고객 상세에서 이어서 보인다.
 */

/** 앞으로 1~7일 중 진료하는 날 10:00~16:00에 시나리오 체어(E3)로 예약을 만든다 */
async function bookFuture(patientId: string): Promise<{ id: string; day: string }> {
  const api = await apiAs("front1");
  for (let d = 1; d <= 7; d += 1) {
    const day = addDays(todayKey(), d);
    for (const time of ["10:00", "11:00", "13:00", "14:00", "15:00", "16:00"]) {
      const res = await api.post("/api/appointments", {
        data: { patientId, startAt: kstDateTime(day, time).toISOString(), durationMin: 30, chair: "E3", treatmentItem: "정기검진", channel: "PHONE" },
      });
      if (res.status() === 201) {
        const id = ((await res.json()) as { appointment: { id: string } }).appointment.id;
        await api.dispose();
        return { id, day };
      }
    }
  }
  throw new Error("앞으로 7일 안에 빈 자리가 없습니다.");
}

async function openDetail(page: Page, day: string, id: string) {
  await page.goto("/calendar");
  await page.getByLabel("날짜 선택").fill(day);
  await page.locator(`[data-appointment-id="${id}"]`).click();
  return page.getByRole("dialog", { name: "예약 상세" });
}

test("앞날 예약을 [예약변경]하고 새 예약을 [취소](사전취소)하면, 고객 상세에서 원 예약 → 새 예약으로 이어서 보인다", async ({ page }) => {
  const api = await apiAs("front1");
  const patient = await createPatient(api);
  await api.dispose();
  const original = await bookFuture(patient.id);
  const newDay = addDays(original.day, 7); // 같은 요일 — 진료하는 날

  await login(page, "front1");
  const dialog = await openDetail(page, original.day, original.id);
  const actions = dialog.getByRole("group", { name: "예약 변경·취소" });
  await actions.getByRole("button", { name: "예약변경" }).click();
  const reschedule = page.getByRole("dialog", { name: /^예약 변경/ });
  await reschedule.getByLabel("날짜").fill(newDay);
  await reschedule.getByLabel("시각").fill("10:30");
  await reschedule.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "(으)로 예약을 변경했습니다." })).toBeVisible();
  await expect(dialog).toContainText("예약변경"); // 원 예약은 예약변경 상태
  await expect(dialog.getByRole("group", { name: "예약 변경·취소" })).toHaveCount(0);

  // 새 예약 찾기(고객 상세 API)
  const reader = await apiAs("front1");
  const detail = (await (await reader.get(`/api/patients/${patient.id}`)).json()) as { appointments: { id: string; rescheduledTo: { id: string } | null }[] };
  const newId = detail.appointments.find((a) => a.id === original.id)!.rescheduledTo!.id;
  await reader.dispose();

  const newDialog = await openDetail(page, newDay, newId);
  await newDialog.getByRole("group", { name: "예약 변경·취소" }).getByRole("button", { name: "취소" }).click();
  const confirm = newDialog.getByRole("alertdialog", { name: "사전취소 확인" });
  await expect(confirm).toContainText("사전취소로 기록합니다");
  await confirm.getByRole("button", { name: "사전취소로 기록" }).click();
  await expect(page.getByRole("status").filter({ hasText: "사전취소로 기록했습니다." })).toBeVisible();
  await expect(newDialog).toContainText("사전취소");

  // 고객 상세에서 추적
  await page.goto(`/patients/${patient.id}`);
  const originalRow = page.locator(`#appt-${original.id}`);
  const newRow = page.locator(`#appt-${newId}`);
  await expect(originalRow).toContainText("예약변경");
  await expect(originalRow).toContainText("(으)로 변경");
  await expect(originalRow).toContainText("최프론트 기록");
  await expect(newRow).toContainText("사전취소");
  await expect(newRow).toContainText("예약에서 변경");
  await originalRow.getByRole("link", { name: /\(으\)로 변경/ }).click();
  await expect(page).toHaveURL(new RegExp(`#appt-${newId}$`));
});

test("버튼은 권한별: 간호는 [취소]만, 의사(원장)는 둘 다 없다", async ({ browser }) => {
  const api = await apiAs("front1");
  const patient = await createPatient(api);
  await api.dispose();
  const booked = await bookFuture(patient.id);
  for (const [loginId, buttons] of [["nurse1", ["취소"]], ["doctor1", []]] as const) {
    const page = await (await browser.newContext()).newPage();
    await login(page, loginId);
    const dialog = await openDetail(page, booked.day, booked.id);
    await expect(dialog.getByRole("region", { name: "기본 정보" })).toBeVisible();
    const group = dialog.getByRole("group", { name: "예약 변경·취소" });
    if (buttons.length === 0) await expect(group).toHaveCount(0);
    else await expect(group.getByRole("button")).toHaveText([...buttons]);
    await page.context().close();
  }
});
