import { expect, test } from "@playwright/test";
import writeExcelFile from "write-excel-file/node";
import { apiAs, fakeName, fakePhone, login } from "./support";

// F-7 기존 CRM 엑셀 가져오기. 엑셀은 실행마다 지어낸 값으로 새로 만든다(실제 데이터 금지 — 절대 규칙 1).
test("관리자는 엑셀을 시험 실행한 뒤 가져오고, 주민번호 열은 빠지며, 다시 가져오면 이미 있는 고객으로 건너뛴다", async ({ page }) => {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  const people = [0, 1].map((i) => ({ name: fakeName(), phone: fakePhone(), chart: `T${suffix}${i}` }));
  const header = ["고객명", "주민등록번호", "휴대폰", "생년월일", "차트번호", "비고"];
  const rows = people.map((p) => [p.name, "000101-3000000", p.phone, { value: new Date(Date.UTC(1990, 0, 2)), format: "yyyy-mm-dd" }, p.chart, "시험 메모"]);
  const buffer = await writeExcelFile([header, ...rows]).toBuffer();

  await login(page, "admin");
  await page.getByRole("link", { name: "가져오기" }).click();
  await expect(page.getByRole("heading", { name: "기존 CRM 데이터 가져오기" })).toBeVisible();
  await page.getByLabel("가짜(시험) 파일만 쓴다는 것을 확인했습니다").check();
  await page.getByLabel(/엑셀 파일/).setInputFiles({ name: "fake.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });

  await expect(page.getByText("데이터 2행")).toBeVisible();
  await expect(page.getByText("주민등록번호 열(1개)은 가져오지 않습니다.")).toBeVisible();
  await expect(page.getByLabel("이름 *")).toHaveValue("0");
  await expect(page.getByLabel("휴대폰 *")).toHaveValue("2");
  // 주민번호 열은 어떤 항목에도 고를 수 없다
  await expect(page.getByLabel("메모").locator("option", { hasText: "주민등록번호" })).toHaveCount(0);

  const importButton = page.getByRole("button", { name: "5. 가져오기" });
  await expect(importButton).toBeDisabled();
  await page.getByRole("button", { name: /시험 실행/ }).click();
  const result = page.getByLabel("가져오기 결과");
  await expect(result).toContainText("시험 실행 결과");
  await expect(result).toContainText("넣을 행 2");

  await importButton.click();
  await expect(result).toContainText("넣은 행 2");

  // 다시 시험 실행 → 이미 있는 고객
  await page.getByRole("button", { name: /시험 실행/ }).click();
  await expect(result).toContainText("이미 있어서 건너뜀 2");

  const api = await apiAs("admin");
  const found = (await (await api.get(`/api/patients?q=${people[0].chart}`)).json()) as { items: { isNewPatient: boolean }[] };
  expect(found.items).toHaveLength(1);
  expect(found.items[0].isNewPatient).toBe(false); // 기존 CRM 고객은 구환
  await api.dispose();
});
