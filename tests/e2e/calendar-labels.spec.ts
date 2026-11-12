import { expect, test } from "@playwright/test";
import {
  apiAs,
  createAppointmentAt,
  createPatient,
  expectClinicOpenToday,
  hasRoomInDay,
  login,
  nowSlot,
} from "./support";

// F-2 예약 색 라벨·[편집] 탭, F-3 칸 크기
type Label = { id: string; name: string; color: string; isActive: boolean };

test.describe("예약 색 라벨과 칸 크기", () => {
  test.skip(!hasRoomInDay(), "자정 앞뒤 1시간에는 '오늘 예약'을 만들 수 없다");

  test("관리자가 [편집]에서 라벨 색을 바꾸면 그 라벨이 붙은 예약 칸 색이 바뀌고, 프론트가 라벨을 바꾸면 대표 라벨 색으로 칠해진다", async ({ browser }) => {
    const front = await apiAs("front1");
    await expectClinicOpenToday(front);
    const style = (await (await front.get("/api/settings/calendar-style")).json()) as { labels: Label[] };
    const label200 = style.labels.find((l) => l.name === "200")!;
    const vip = style.labels.find((l) => l.name === "vip")!;
    expect(label200 && vip, "기본 라벨(마이그레이션)").toBeTruthy();

    const patient = await createPatient(front);
    // 다른 시나리오(노쇼·되돌리기)가 지금 시각 앞의 빈 자리를 쓰므로, 이 시나리오는 지금보다 뒤의 자리를 쓴다.
    const later = Array.from({ length: 40 }, (_, i) => nowSlot() + 60 + i * 30).filter((m) => m + 30 <= 24 * 60);
    const appointment = await createAppointmentAt(front, patient.id, later);
    expect((await front.put(`/api/appointments/${appointment.id}/labels`, { data: { labelIds: [label200.id] } })).ok()).toBeTruthy();
    await front.dispose();

    // 1) 관리자: [편집] 탭에서 '200' 색을 바꿔 저장
    const adminPage = await (await browser.newContext()).newPage();
    await login(adminPage, "admin");
    await adminPage.goto("/calendar");
    await adminPage.getByRole("group", { name: "화면" }).getByRole("button", { name: "편집" }).click();
    await adminPage.getByLabel("200 색 코드").fill("#00AA00");
    await adminPage.getByRole("button", { name: "저장", exact: true }).click();
    await expect(adminPage.getByRole("status").filter({ hasText: "색 설정을 저장했습니다." })).toBeVisible();
    await adminPage.getByRole("group", { name: "화면" }).getByRole("button", { name: "캘린더" }).click();
    const adminBlock = adminPage.locator(`[data-appointment-id="${appointment.id}"]`);
    await expect(adminBlock).toHaveCSS("background-color", "rgb(0, 170, 0)");
    await adminPage.context().close();

    // 2) 프론트: [편집] 탭이 없고, 상세에서 200을 빼고 vip를 붙이면 vip 색이 된다
    const page = await (await browser.newContext()).newPage();
    await login(page, "front1");
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "예약 캘린더" })).toBeVisible();
    await expect(page.getByRole("group", { name: "화면" })).toHaveCount(0);
    const block = page.locator(`[data-appointment-id="${appointment.id}"]`);
    await expect(block).toHaveCSS("background-color", "rgb(0, 170, 0)");
    await expect(page.getByLabel("색 범례")).toContainText("vip");

    await block.click();
    const dialog = page.getByRole("dialog", { name: "예약 상세" });
    await dialog.getByRole("button", { name: "200", exact: true }).click();
    await dialog.getByRole("button", { name: "vip", exact: true }).click();
    await dialog.getByRole("button", { name: "라벨 저장" }).click();
    await expect(page.getByRole("status").filter({ hasText: "라벨을 저장했습니다." })).toBeVisible();
    await dialog.getByRole("button", { name: "닫기" }).click();
    const hex = vip.color.replace("#", "");
    const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    await expect(block).toHaveCSS("background-color", rgb);
    await page.context().close();
  });

  test("가로규격을 200px로 바꾸면 열이 넓어지고 새로고침해도 유지된다", async ({ page }) => {
    const api = await apiAs("front1");
    await expectClinicOpenToday(api);
    await api.dispose();
    await login(page, "front1");
    await page.goto("/calendar");
    await page.getByLabel("가로규격").selectOption("200");
    const firstCell = page.getByRole("button", { name: / 예약 등록$/ }).first();
    // 열 왼쪽 테두리(1px)만큼 칸이 좁다
    await expect.poll(async () => Math.round((await firstCell.boundingBox())?.width ?? 0)).toBeGreaterThanOrEqual(198);
    expect(Math.round((await firstCell.boundingBox())?.width ?? 0)).toBeLessThanOrEqual(200);
    await page.reload();
    await expect(page.getByLabel("가로규격")).toHaveValue("200");
    await page.getByLabel("세로규격").selectOption("large");
    await expect(page.getByLabel("세로규격")).toHaveValue("large");
  });
});
