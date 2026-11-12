/**
 * 화면 시나리오 공통 도구 — 로그인, 가짜 고객·예약 만들기(API), 빈 자리 찾기.
 *
 * - 시나리오마다 자기 고객·예약을 새로 만들어 쓴다(다른 시나리오 결과에 기대지 않는다).
 * - 이름은 지어낸 이름, 전화번호는 테스트용 010-0XXX-XXXX만 쓴다(절대 규칙 1).
 * - 비밀번호는 .env의 SEED_STAFF_PASSWORD를 process.env로만 읽는다. 출력하거나 파일에 쓰지 않는다.
 * - 시각 계산은 한국 시간(src/lib/time/kst.ts)으로 한다. 서버도 같은 시계를 쓴다(같은 PC).
 */
import { type APIRequestContext, expect, type Page, request as playwrightRequest } from "@playwright/test";
import { maskName } from "@/lib/masking";
import { formatKstTime, kstDateKey, kstDateTime, kstMinutesOfDay, kstWeekday } from "@/lib/time/kst";

export const BASE_URL = "http://127.0.0.1:3105";

export type LoginId = "admin" | "doctor1" | "doctor2" | "front1" | "counselor1";

function password(): string {
  const value = process.env.SEED_STAFF_PASSWORD;
  if (!value) throw new Error("SEED_STAFF_PASSWORD가 없습니다(.env).");
  return value;
}

/** 로그인 화면으로 로그인하고 내원 보드에 도착할 때까지 기다린다. */
export async function login(page: Page, loginId: LoginId): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("아이디").fill(loginId);
  await page.getByLabel("비밀번호").fill(password());
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

/** API로만 로그인한 요청 도구 — 시나리오 준비(고객·예약 만들기)에 쓴다. */
export async function apiAs(loginId: LoginId): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const response = await api.post("/api/auth/login", { data: { loginId, password: password() } });
  expect(response.ok(), `${loginId} API 로그인`).toBeTruthy();
  return api;
}

const SURNAMES = ["한", "윤", "서", "남", "도", "류", "변", "음"];
const SYLLABLES = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하", "솔", "빛", "온", "결"];
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** 지어낸 세 글자 이름 */
export function fakeName(): string {
  return `${pick(SURNAMES)}${pick(SYLLABLES)}${pick(SYLLABLES)}`;
}

/** 테스트용 번호 010-0XXX-XXXX */
export function fakePhone(): string {
  const digits = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
  return `010-0${digits(3)}-${digits(4)}`;
}

export type TestPatient = { id: string; name: string; nameMasked: string; phone: string };

/** 새 고객 등록. 우연히 기존 번호와 겹치면(409) 다른 번호로 다시 한다. */
export async function createPatient(api: APIRequestContext, name = fakeName()): Promise<TestPatient> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const phone = fakePhone();
    const response = await api.post("/api/patients", { data: { name, phone, visitType: "NEW" } });
    if (response.status() === 409) continue;
    expect(response.status(), "고객 등록").toBe(201);
    const { id } = (await response.json()) as { id: string };
    return { id, name, nameMasked: maskName(name), phone };
  }
  throw new Error("겹치지 않는 테스트 번호를 찾지 못했습니다.");
}

export type DayAppointment = { id: string; chair: string; startAt: string; endAt: string; status: string };

export function todayKey(): string {
  return kstDateKey(new Date());
}

/** 지금(한국 시간)이 자정부터 몇 분인지 */
export function nowMinutes(): number {
  return kstMinutesOfDay(new Date());
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 진료 체어 코드. 상담실은 고가 항목만 받으므로(F-5) 일반 항목(정기검진)으로 예약하는 시나리오는 빼고 쓴다. */
export async function chairCodes(api: APIRequestContext): Promise<string[]> {
  const response = await api.get("/api/settings");
  expect(response.ok()).toBeTruthy();
  const settings = (await response.json()) as { chairs: { code: string; kind: string }[] };
  return settings.chairs.filter((chair) => chair.kind === "CHAIR").map((chair) => chair.code);
}

export async function todayAppointments(api: APIRequestContext): Promise<DayAppointment[]> {
  const day = todayKey();
  const response = await api.get(`/api/appointments?from=${day}&to=${day}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { items: DayAppointment[] }).items;
}

/** 그 체어의 [start, end) 분 구간에 어떤 상태든 예약 블록이 있으면 true (화면에서 칸이 가려지지 않게 넉넉히 본다) */
export function isOccupied(items: DayAppointment[], chair: string, start: number, end: number): boolean {
  const day = todayKey();
  const from = kstDateTime(day, minutesToTime(start)).getTime();
  const to = kstDateTime(day, minutesToTime(end)).getTime();
  return items.some(
    (item) => item.chair === chair && new Date(item.startAt).getTime() < to && new Date(item.endAt).getTime() > from,
  );
}

export type CreatedAppointment = { id: string; chair: string; start: number; time: string };

/**
 * 오늘 starts(분) 중 앞에서부터, 비어 있는 체어에 예약을 만든다. 겹침(409)이면 다음 자리로.
 */
export async function createAppointmentAt(
  api: APIRequestContext,
  patientId: string,
  starts: number[],
  options: { durationMin?: number; isFree?: (chair: string, start: number) => boolean } = {},
): Promise<CreatedAppointment> {
  const durationMin = options.durationMin ?? 30;
  const chairs = await chairCodes(api);
  const items = await todayAppointments(api);
  const day = todayKey();
  for (const start of starts) {
    if (start < 0 || start + durationMin > 24 * 60) continue;
    for (const chair of chairs) {
      if (isOccupied(items, chair, start, start + durationMin)) continue;
      if (options.isFree && !options.isFree(chair, start)) continue;
      const response = await api.post("/api/appointments", {
        data: {
          patientId,
          startAt: kstDateTime(day, minutesToTime(start)).toISOString(),
          durationMin,
          chair,
          treatmentItem: "정기검진",
          channel: "PHONE",
        },
      });
      if (response.status() === 409) continue;
      expect(response.status(), "예약 등록").toBe(201);
      const { appointment } = (await response.json()) as { appointment: { id: string; startAt: string } };
      return { id: appointment.id, chair, start, time: formatKstTime(new Date(appointment.startAt)) };
    }
  }
  throw new Error("오늘 빈 자리를 찾지 못했습니다.");
}

/** 5분 단위로 내린 지금(분) */
export function nowSlot(): number {
  return Math.floor(nowMinutes() / 5) * 5;
}

/** 시작 후보: from부터 5분씩 거슬러 count개 */
export function slotsBackFrom(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from - i * 5).filter((m) => m >= 0);
}

/** 내원 보드의 행 — 행 이름(aria-label)이 "HH:mm 마스킹이름 상태…" */
/** 내원 보드의 한 줄. 가린 이름은 다른 환자와 겹칠 수 있으므로 예약 ID로 찾는다. */
export function boardRow(page: Page, appointmentId: string) {
  return page.locator(`[data-testid="board-row"][data-appointment-id="${appointmentId}"]`);
}

/** 오늘 그 체어·시각(분)에 시작하는 예약 ID (화면에서 만든 예약을 찾을 때) */
export async function appointmentIdAt(api: APIRequestContext, chair: string, startMinutes: number): Promise<string> {
  const startAt = kstDateTime(todayKey(), minutesToTime(startMinutes)).getTime();
  const found = (await todayAppointments(api)).filter(
    (item) => item.chair === chair && new Date(item.startAt).getTime() === startAt,
  );
  expect(found, "그 체어·시각의 예약").toHaveLength(1);
  return found[0].id;
}

/** 상단 요약의 숫자 하나(내원·대기·노쇼·미확인) */
export async function summaryCount(page: Page, label: "내원" | "대기" | "노쇼" | "미확인"): Promise<number> {
  const summary = page.getByRole("region", { name: "오늘 요약" });
  const value = summary.getByText(label, { exact: true }).locator("xpath=following-sibling::span[1]");
  return Number(await value.innerText());
}

/** 시나리오가 한국 시간 하루 안에서 앞뒤로 시간을 쓰므로, 자정 근처에는 돌리지 않는다. */
export function hasRoomInDay(): boolean {
  const now = nowMinutes();
  return now >= 60 && now <= 23 * 60;
}

/**
 * 오늘이 진료일이어야 일 보기에 예약 칸이 있다. E2E DB는 준비 단계(scripts/e2e/setup-db.ts)에서
 * 일요일도 진료일로 바꿔 두므로 요일 때문에 건너뛰지 않는다 — 휴진이면 건너뛰지 말고 실패시킨다.
 */
export async function expectClinicOpenToday(api: APIRequestContext): Promise<void> {
  const response = await api.get("/api/settings");
  expect(response.ok()).toBeTruthy();
  const settings = (await response.json()) as { businessHours: Record<string, unknown> };
  expect(settings.businessHours[String(kstWeekday(todayKey()))], "오늘 진료시간(E2E DB는 매일 진료)").toBeTruthy();
}
