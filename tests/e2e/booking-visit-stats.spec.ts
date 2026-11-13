import { expect, type Page, test } from "@playwright/test";
import { formatKstDateLabel, kstWeekStart } from "@/lib/time/kst";
import {
  apiAs,
  appointmentIdAt,
  boardRow,
  chairCodes,
  fakeName,
  fakePhone,
  hasRoomInDay,
  expectClinicOpenToday,
  isOccupied,
  login,
  minutesToTime,
  nowMinutes,
  nowSlot,
  slotsBackFrom,
  summaryCount,
  todayAppointments,
  todayKey,
} from "./support";
import { maskName } from "@/lib/masking";

/** 통계 화면에서 '이번 주'를 고르고 실내원율 칸의 "내원 N / 유효 예약 M"에서 N을 읽는다. */
async function weeklyArrived(page: Page): Promise<number> {
  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "내원 통계" })).toBeVisible();
  await page.getByRole("button", { name: "이번 주" }).click();
  await expect(page.getByRole("button", { name: "이번 주" })).toHaveAttribute("aria-pressed", "true");
  // 이번 주 응답이 오면 기간 표시가 이번 주 월요일부터로 바뀐다
  await expect(page.getByText(`${formatKstDateLabel(kstWeekStart(todayKey()))} ~`)).toBeVisible();
  await expect(page.locator("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  const detail = await page.getByText(/^내원 \d+ \/ 유효 예약 \d+$/).innerText();
  return Number(/^내원 (\d+)/.exec(detail)![1]);
}

test.describe("예약 → 내원 → 통계", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 '오늘 이미 시작한 예약'을 만들 수 없다");

  test("캘린더 빈 칸에 이미 시작한 시각으로 예약하고, 보드에서 [내원] 한 번이면 요약과 통계의 내원 수가 1 늘어난다", async ({ page }) => {
    const api = await apiAs("admin");
    await expectClinicOpenToday(api);
    await login(page, "admin");
    const arrivedBefore = await weeklyArrived(page);

    // 1) 캘린더 일 보기(오늘)에서 빈 칸을 고른다. 가능하면 지금보다 이른(이미 시작한) 30분 칸
    const today = todayKey();
    const chairs = await chairCodes(api);
    const items = await todayAppointments(api);
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "예약 캘린더" })).toBeVisible();
    await expect(page.getByRole("group", { name: "보기" }).getByRole("button", { name: "일" })).toHaveAttribute("aria-pressed", "true");
    const cell = (chair: string, minutes: number) =>
      page.getByRole("button", { name: `${chair} ${today} ${minutesToTime(minutes)} 예약 등록`, exact: true });
    await expect(page.getByRole("button", { name: /예약 등록$/ }).first()).toBeVisible();

    let picked: { chair: string; row: number } | null = null;
    for (let row = Math.floor(nowMinutes() / 30) * 30; row >= 0 && !picked; row -= 30) {
      for (const chair of chairs) {
        if (!isOccupied(items, chair, row, row + 30) && (await cell(chair, row).count()) === 1) {
          picked = { chair, row };
          break;
        }
      }
    }
    // 이른 칸이 하나도 비어 있지 않으면(진료 시작 전 등) 아무 빈 칸을 누르고 시각만 이미 시작한 시각으로 바꾼다.
    let startMinutes = picked?.row ?? -1;
    if (!picked) {
      outer: for (const chair of chairs) {
        for (const start of slotsBackFrom(nowSlot(), 60)) {
          if (isOccupied(items, chair, start, start + 30)) continue;
          for (let row = 0; row < 24 * 60; row += 30) {
            if (!isOccupied(items, chair, row, row + 30) && (await cell(chair, row).count()) === 1) {
              picked = { chair, row };
              startMinutes = start;
              break outer;
            }
          }
        }
      }
    }
    expect(picked, "오늘 빈 칸").not.toBeNull();
    const time = minutesToTime(startMinutes);
    expect(startMinutes).toBeLessThanOrEqual(nowMinutes());

    await cell(picked!.chair, picked!.row).click();
    const dialog = page.getByRole("dialog", { name: "예약 등록" });
    await expect(dialog).toBeVisible();
    if (startMinutes !== picked!.row) await dialog.getByLabel("시각").fill(time);
    await expect(dialog.getByLabel("시각")).toHaveValue(time);

    // 2) 신규 고객을 이름·휴대폰(테스트 번호)으로 바로 등록해 고른다
    const name = fakeName();
    const masked = maskName(name);
    await dialog.getByRole("button", { name: "신규 고객 등록" }).click();
    await dialog.getByLabel("이름").fill(name);
    await dialog.getByLabel("휴대폰").fill(fakePhone());
    await dialog.getByRole("button", { name: "고객 등록 후 선택" }).click();
    const selected = dialog.getByTestId("booking-selected-patient");
    const duplicate = dialog.getByRole("button", { name: "다른 사람입니다 — 새로 등록" });
    await expect(selected.or(duplicate)).toBeVisible();
    if (await duplicate.isVisible()) await duplicate.click(); // 우연히 기존 번호와 같으면 다른 사람으로 등록
    await expect(selected).toContainText(masked);

    await dialog.getByLabel("예약 항목").selectOption("정기검진");
    await dialog.getByRole("button", { name: "예약 등록", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "예약을 등록했습니다." })).toBeVisible();
    await expect(page.getByRole("button", { name: `${time} ${masked} 정기검진 예약확정 예약` })).toBeVisible();

    // 3) 내원 보드에서 그 줄의 [내원]을 한 번 누른다
    const appointmentId = await appointmentIdAt(api, picked!.chair, startMinutes);
    await page.goto("/board");
    const row = boardRow(page, appointmentId);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${time} \\S+ 예약확정`));
    const summaryBefore = await summaryCount(page, "내원");

    await row.getByRole("button", { name: "내원", exact: true }).click();
    const toast = page.getByRole("status").filter({ hasText: `${masked} ` });
    await expect(toast).toContainText(/(지각내원|내원) 처리됨/);
    await expect(toast.getByRole("button", { name: /되돌리기/ })).toBeVisible();
    await expect(row).toHaveAttribute("aria-label", new RegExp(`^${time} \\S+ (지각내원|내원)`));
    await expect(row.getByRole("button", { name: "되돌리기" })).toBeVisible();
    await expect.poll(() => summaryCount(page, "내원")).toBe(summaryBefore + 1);

    // 4) 통계(이번 주)의 내원 수가 1 늘었다
    expect(await weeklyArrived(page)).toBe(arrivedBefore + 1);
    await api.dispose();
  });
});
