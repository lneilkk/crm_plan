import { expect, type Page, test } from "@playwright/test";
import { apiAs, createPatient, HOME_OF, login, type LoginId } from "./support";

/**
 * 확장 계획 S-4 — 부서별 첫 화면과 메뉴, 숨긴 화면 주소로 들어왔을 때의 반응.
 * - 첫 화면은 설정값(초기값: 프론트 내원 보드, 상담 상담, 진료 예약 캘린더, 운영 통계).
 * - 메뉴는 권한에서 계산된다.
 * - 권한 없는 화면 주소: "권한 없음" 안내만. 그 화면의 데이터 API를 부르지 않고, 가짜 값이 잠깐이라도 보이지 않는다. API를 직접 불러도 403.
 */

const MENUS: Record<LoginId, string[]> = {
  front1: ["내원 보드", "예약 캘린더", "고객"],
  counselor1: ["내원 보드", "예약 캘린더", "상담", "고객"],
  nurse1: ["내원 보드", "예약 캘린더", "고객"],
  doctor1: ["내원 보드", "예약 캘린더", "상담", "고객", "통계"], // 원장: 진료 + 추가 권한
  doctor2: ["내원 보드", "예약 캘린더", "상담", "고객", "통계"],
  admin: ["내원 보드", "예약 캘린더", "상담", "고객", "통계", "가져오기"],
};

/** 화면이 그리면 안 되는 내용(그 화면이 실행되면 바로 보이는 글자) */
const FORBIDDEN_TEXT: Record<string, string[]> = {
  "/consult": ["전체 상담", "초진(신환) 상담", "전환율"],
  "/stats": ["내원 통계", "실내원율"],
  "/import": ["기존 CRM 데이터 가져오기"],
  "/patients/new": ["휴대폰 *", "덴트웹 차트번호"],
};
const DATA_API: Record<string, RegExp> = {
  "/consult": /\/api\/consultations/,
  "/stats": /\/api\/stats/,
  "/import": /\/api\/import/,
  "/patients/new": /\/api\/patients(\?|$)/,
};

/** 문서가 만들어질 때부터 화면 글자를 지켜본다 — 한 번이라도 나타난 금지 글자를 기록 */
async function watchText(page: Page, words: string[]) {
  await page.addInitScript((list: string[]) => {
    const seen: string[] = [];
    (window as unknown as { __seenWords: string[] }).__seenWords = seen;
    const check = () => {
      const text = document.body?.innerText ?? "";
      for (const word of list) if (text.includes(word) && !seen.includes(word)) seen.push(word);
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  }, words);
}

test.describe("부서별 첫 화면과 메뉴", () => {
  for (const loginId of ["front1", "counselor1", "nurse1", "doctor1", "admin"] as LoginId[]) {
    test(`${loginId}: 로그인하면 ${HOME_OF[loginId]}, 메뉴는 ${MENUS[loginId].join("·")}`, async ({ page }) => {
      await login(page, loginId); // 첫 화면 URL까지 확인한다
      await expect(page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link")).toHaveText(MENUS[loginId]);
      // "/"로 와도 첫 화면으로
      await page.goto("/");
      await expect(page).toHaveURL(new RegExp(`${HOME_OF[loginId]}$`));
    });
  }
});

test.describe("권한 없는 화면 주소", () => {
  const CASES: [LoginId, string[]][] = [
    ["front1", ["/consult", "/stats", "/import"]],
    ["nurse1", ["/consult", "/stats", "/import", "/patients/new"]],
  ];
  for (const [loginId, paths] of CASES) {
    test(`${loginId}: ${paths.join(", ")} → 권한 없음 안내만, 데이터 API 호출 없음, 가짜 값이 한 번도 안 보임`, async ({ page }) => {
      await login(page, loginId);
      await watchText(page, paths.flatMap((p) => FORBIDDEN_TEXT[p]));
      const calls: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/")) calls.push(url.pathname + url.search);
      });

      for (const path of paths) {
        await page.goto(path);
        const alert = page.getByRole("alert").filter({ hasText: "이 화면을 볼 권한이 없습니다" });
        await expect(alert).toBeVisible();
        await page.waitForTimeout(1000); // 늦게 그려지는 것까지 지켜본다
        const seen = await page.evaluate(() => (window as unknown as { __seenWords: string[] }).__seenWords);
        expect(seen, `${path}에서 보인 금지 글자`).toEqual([]);
        expect(calls.filter((call) => DATA_API[path].test(call)), `${path}의 데이터 API 호출`).toEqual([]);
        // [첫 화면으로]는 그 사람의 첫 화면
        await expect(alert.getByRole("link", { name: "첫 화면으로" })).toHaveAttribute("href", HOME_OF[loginId]);
      }

      // 서버도 거부한다
      const today = new Date().toISOString().slice(0, 10);
      expect((await page.request.get(`/api/consultations?date=${today}`)).status()).toBe(403);
      expect((await page.request.get(`/api/stats?from=${today}&to=${today}&unit=day`)).status()).toBe(403);
    });
  }

  test("권한 있는 화면은 그대로 열린다 (고객 상세, 프론트의 고객 등록)", async ({ page }) => {
    const api = await apiAs("front1");
    const patient = await createPatient(api);
    await api.dispose();
    await login(page, "nurse1");
    await page.goto(`/patients/${patient.id}`);
    await expect(page.getByRole("heading", { name: patient.name })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "이 화면을 볼 권한이 없습니다" })).toHaveCount(0);
    await page.getByRole("button", { name: "로그아웃" }).click();
    await login(page, "front1");
    await page.goto("/patients/new");
    await expect(page.getByRole("heading", { name: "고객 등록" })).toBeVisible();
    await expect(page.getByLabel("휴대폰 *")).toBeVisible();
  });
});

test("관리자 [편집] → [부서별 첫 화면]에 네 부서의 첫 화면이 보인다", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/calendar");
  await page.getByRole("group", { name: "화면" }).getByRole("button", { name: "편집" }).click();
  await page.getByRole("navigation", { name: "편집 메뉴" }).getByRole("button", { name: "부서별 첫 화면" }).click();
  await expect(page.getByLabel("프론트 첫 화면")).toHaveValue("/board");
  await expect(page.getByLabel("상담 첫 화면")).toHaveValue("/consult");
  await expect(page.getByLabel("진료 첫 화면")).toHaveValue("/calendar");
  await expect(page.getByLabel("운영 첫 화면")).toHaveValue("/stats");
});
