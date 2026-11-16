import { expect, test } from "@playwright/test";
import { fakeName, fakePhone, login } from "./support";
import { maskName } from "@/lib/masking";

// F-10 상담 탭: 상담 등록(민감정보 동의) → 상담 보드 카드 → 수술예약 전환. 프론트는 상담 메뉴가 없다(T6-1).
test("상담자는 상담을 등록하고 수술예약으로 전환한다", async ({ page }) => {
  const name = fakeName();
  await login(page, "counselor1");
  await page.getByRole("link", { name: "상담", exact: true }).click();
  await expect(page.getByRole("heading", { name: "상담", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "+ 상담 등록" }).click();
  const dialog = page.getByRole("dialog", { name: "상담 등록" });
  await dialog.getByRole("button", { name: "신규 고객 등록" }).click();
  await dialog.getByLabel("이름").fill(name);
  await dialog.getByLabel("휴대폰").fill(fakePhone());
  await dialog.getByRole("button", { name: "고객 등록 후 선택" }).click();
  const duplicate = dialog.getByRole("button", { name: "다른 사람입니다 — 새로 등록" });
  if (await duplicate.isVisible().catch(() => false)) await duplicate.click();
  await expect(dialog.getByTestId("booking-selected-patient")).toContainText(maskName(name));
  await dialog.getByRole("button", { name: "임플란트" }).click();
  await dialog.getByLabel("상담 내용", { exact: true }).fill("시험 상담: 임플란트 비용 안내");
  await dialog.getByLabel("이 고객에게 민감정보(상담 내용) 처리 동의를 받았습니다").check();
  await dialog.getByRole("button", { name: "상담 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "상담을 등록했습니다." })).toBeVisible();

  const column = page.getByRole("region", { name: "신환상담 정상담" });
  const card = column.getByRole("button", { name: new RegExp(`${maskName(name).replace("*", "\\*")} 대기 상담`) });
  await expect(card).toBeVisible();
  await card.click();
  const detail = page.getByRole("dialog", { name: "상담 상세" });
  await expect(detail).toContainText("시험 상담: 임플란트 비용 안내");
  await detail.getByRole("button", { name: "→ 수술예약" }).click();
  const form = detail.getByRole("form", { name: "수술예약" });
  await expect(form.getByLabel("수술 항목")).toHaveValue("임플란트");
  await form.getByLabel("체어").selectOption("E1");
  await form.getByRole("button", { name: "수술예약 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "수술예약을 만들었습니다." })).toBeVisible();
  await detail.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(column.getByRole("button", { name: /수술예약 상담/ })).toContainText("수술예약");
});

test("프론트에게는 상담 메뉴가 없다", async ({ page }) => {
  await login(page, "front1");
  await expect(page.getByRole("link", { name: "예약 캘린더" })).toBeVisible();
  await expect(page.getByRole("link", { name: "상담", exact: true })).toHaveCount(0);
});
