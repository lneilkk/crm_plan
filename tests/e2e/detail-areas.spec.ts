import { expect, test } from "@playwright/test";
import { kstDateTime } from "@/lib/time/kst";
import { apiAs, createPatient, expectClinicOpenToday, hasRoomInDay, login, type LoginId, minutesToTime, nowSlot, todayKey } from "./support";

/**
 * 확장 계획 S-5 — 부서별로 예약 상세에 보이는 영역이 표(docs/SCREEN_MAP.md 8장)와 같다.
 * 같은 고가 항목(임플란트) 예약을 역할 5개로 열어, 상세 창 안의 영역 이름을 순서대로 비교한다.
 * 권한이 없는 영역은 빈 틀도 없어야 한다(영역 목록에 없음).
 */
const AREAS: Record<LoginId, string[]> = {
  front1: ["기본 정보", "수술 참여 직원"],
  counselor1: ["기본 정보", "상담·할인", "수술 참여 직원"],
  doctor1: ["기본 정보", "상담·할인", "수술 참여 직원", "수술 메모"], // 원장: 진료 + 추가 권한
  doctor2: ["기본 정보", "상담·할인", "수술 참여 직원", "수술 메모"],
  nurse1: ["기본 정보", "수술 참여 직원"],
  admin: ["기본 정보", "상담·할인", "수술 참여 직원", "수술 메모"],
};

test.describe("예약 상세 영역", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 '오늘 예약'을 만들 수 없다");
  let id: string | null = null;

  test.beforeAll(async () => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    const patient = await createPatient(api);
    for (let start = nowSlot() + 60; start + 60 <= 24 * 60 && !id; start += 30) {
      const res = await api.post("/api/appointments", {
        data: { patientId: patient.id, startAt: kstDateTime(todayKey(), minutesToTime(start)).toISOString(), durationMin: 60, chair: "E3", treatmentItem: "임플란트", channel: "PHONE" },
      });
      if (res.status() === 201) id = ((await res.json()) as { appointment: { id: string } }).appointment.id;
    }
    await api.dispose();
  });

  for (const loginId of ["front1", "counselor1", "doctor1", "nurse1", "admin"] as LoginId[]) {
    test(`${loginId}: ${AREAS[loginId].join(" / ")}`, async ({ page }) => {
      expect(id, "E3 빈 자리").not.toBeNull();
      await login(page, loginId);
      await page.goto("/calendar");
      await page.locator(`[data-appointment-id="${id}"]`).click();
      const dialog = page.getByRole("dialog", { name: "예약 상세" });
      await expect(dialog.getByRole("region", { name: "기본 정보" })).toBeVisible();
      // 따로 읽는 수술 메모까지 그려질 시간을 준 뒤 영역 목록을 비교한다
      if (AREAS[loginId].includes("수술 메모")) await expect(dialog.getByRole("button", { name: "수술 메모 저장" })).toBeVisible();
      const names = await dialog.getByRole("region").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
      expect(names).toEqual(AREAS[loginId]);
      // 금액 줄은 상담·할인 영역 안에만 있다
      await expect(dialog.getByText("금액", { exact: true })).toHaveCount(AREAS[loginId].includes("상담·할인") ? 1 : 0);
    });
  }
});
