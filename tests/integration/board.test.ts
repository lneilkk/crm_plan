/**
 * T5-3 내원 보드 API — GET /api/board.
 *
 * - 정해 둔 과거 날짜 하루를 만들어 내용·순서·요약·한국 시간 날짜 경계를 본다.
 * - 지각은 병원 설정의 지각 허용시간으로 자동 판정되는지 본다.
 * - 버튼은 응답의 서버 시각(serverNow)으로 계산한 availableActions와 같아야 한다.
 * - 프론트가 읽을 수 있고, 감사 행이 남고, 응답에 전체 이름·전화번호가 없는지 본다.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AppointmentStatus } from "@/lib/domain/appointment";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/domain/clinic";
import { addDays, kstDateKey, kstDateTime } from "@/lib/time/kst";
import { availableActions } from "@/lib/visit/transitions";
import { GET as boardRoute } from "@/app/api/board/route";
import { POST as revertRoute } from "@/app/api/appointments/[id]/revert/route";
import { POST as statusRoute } from "@/app/api/appointments/[id]/status/route";
import { createAppointment as createAppointmentService } from "@/server/appointments/create";
import type { BoardResponse } from "@/server/board/query";
import { sealPhone } from "@/server/crypto/pii";
import { callRoute, loginAs } from "./helpers/api";
import { createAppointment, createPatient, createStaff, db, resetDb } from "./helpers";

const DAY = "2026-03-10";
const at = (time: string, day = DAY) => kstDateTime(day, time);
const LATE_TOLERANCE_MIN = 30;
const MINUTE = 60_000;

let front: Awaited<ReturnType<typeof loginAs>>;

beforeEach(async () => {
  await resetDb();
  await db.clinicSetting.create({
    data: { id: 1, ...DEFAULT_CLINIC_SETTINGS, lateToleranceMin: LATE_TOLERANCE_MIN },
  });
  front = await loginAs("FRONT");
});

function getBoard(query = `?date=${DAY}`, cookie = front.cookie) {
  return callRoute(boardRoute, { url: `/api/board${query}`, cookie });
}

let chairSeq = 0;
/** 체어를 돌려 써서 같은 시각 예약끼리 겹치지 않게 한다 */
function book(time: string, status: AppointmentStatus, extra: Parameters<typeof createAppointment>[0] = {}) {
  const chair = DEFAULT_CLINIC_SETTINGS.chairs[chairSeq++ % 4].code;
  return createAppointment({ startAt: at(time), chair, status, ...extra });
}

describe("GET /api/board", () => {
  it("그날(한국 시간) 예약만 시각순으로, 요약과 함께 돌려준다", async () => {
    const doctor = await createStaff({ role: "DOCTOR", name: "가상원장" });
    const counselor = await createStaff({ role: "COUNSELOR", name: "가상상담" });

    // 날짜 경계: 전날 23:55, 다음날 00:00은 빠지고 그날 00:00, 23:55는 들어간다
    await book("23:55", "BOOKED", { startAt: at("23:55", addDays(DAY, -1)) });
    await book("00:00", "BOOKED", { startAt: at("00:00", addDays(DAY, 1)) });
    const first = await book("00:00", "BOOKED", { startAt: at("00:00") });
    const last = await book("23:55", "BOOKED", { startAt: at("23:55") });

    const newPatient = await createPatient({ visitType: "NEW", referralSource: "WEBSITE" });
    const onTime = await book("10:00", "ARRIVED", {
      patientId: newPatient.id,
      arrivedAt: at("10:30"), // 허용시간 30분 정각 → 지각 아님
      doctorId: doctor.id,
      counselorId: counselor.id,
      channel: "WEBSITE",
      treatmentItem: "임플란트",
    });
    const late = await book("10:00", "ARRIVED", { arrivedAt: at("10:31") });
    const noShow = await book("11:00", "NO_SHOW");
    const sameDayCancel = await book("11:30", "CANCELED_SAME_DAY");
    const advanceCancel = await book("12:00", "CANCELED_ADVANCE");

    // 예약변경: 다른 날로 옮긴 원 예약, 같은 날 안에서 옮긴 원 예약은 빠지고 새 예약만 보인다
    const movedAway = await book("13:00", "RESCHEDULED");
    await book("13:00", "BOOKED", { startAt: at("13:00", addDays(DAY, 3)), originalAppointmentId: movedAway.id });
    const movedWithin = await book("14:00", "RESCHEDULED");
    const successor = await book("15:00", "BOOKED", {
      patientId: movedWithin.patientId,
      originalAppointmentId: movedWithin.id,
    });

    const { status, json } = await getBoard();
    expect(status).toBe(200);
    const board = json as BoardResponse;
    expect(board.date).toBe(DAY);

    // 같은 시각은 체어 순
    const tenOClock = [onTime, late].toSorted((a, b) => a.chair.localeCompare(b.chair)).map((a) => a.id);
    const ids = board.items.map((row) => row.id);
    expect(ids).toEqual([first.id, ...tenOClock, noShow.id, sameDayCancel.id, advanceCancel.id, successor.id, last.id]);
    expect(ids).not.toContain(movedAway.id);
    expect(ids).not.toContain(movedWithin.id);
    expect(board.items.map((row) => row.time)).toEqual([
      "00:00",
      "10:00",
      "10:00",
      "11:00",
      "11:30",
      "12:00",
      "15:00",
      "23:55",
    ]);

    // 지각: 설정의 허용시간(30분) 기준으로 자동 판정
    const byId = new Map(board.items.map((row) => [row.id, row]));
    expect(byId.get(onTime.id)).toMatchObject({ isLate: false, statusLabel: "내원" });
    expect(byId.get(late.id)).toMatchObject({ isLate: true, statusLabel: "지각내원" });

    // 행 내용
    expect(byId.get(onTime.id)).toMatchObject({
      patientId: newPatient.id,
      time: "10:00",
      isNew: true,
      treatmentItem: "임플란트",
      doctorName: "가상원장",
      counselorName: "가상상담",
      referralSource: "WEBSITE",
      channel: "WEBSITE",
      status: "ARRIVED",
      arrivedAt: at("10:30").toISOString(),
      overdue: "none",
    });
    // 과거 날짜의 대기 상태 예약은 유예시간이 지났으므로 빨강
    expect(byId.get(first.id)?.overdue).toBe("red");

    // 요약: 사전취소는 예약 수에서 빠진다. 과거 날짜라 대기는 0, 대기 상태 두 건은 미확인
    expect(board.summary).toEqual({
      total: 7,
      arrived: 2,
      waiting: 0,
      noShow: 1,
      unconfirmed: 3,
      sameDayCanceled: 1,
      late: 1,
    });
  });

  it("신규 배지는 등록 구분이 신규이고 앞서 내원한 예약이 없을 때만", async () => {
    const neverArrived = await createPatient({ visitType: "NEW" });
    const arrivedBefore = await createPatient({ visitType: "NEW" });
    const returning = await createPatient({ visitType: "RETURNING" });
    await book("09:30", "ARRIVED", {
      patientId: arrivedBefore.id,
      startAt: at("09:30", addDays(DAY, -7)),
      arrivedAt: at("09:30", addDays(DAY, -7)),
    });
    const a = await book("10:00", "BOOKED", { patientId: neverArrived.id });
    const b = await book("10:00", "BOOKED", { patientId: arrivedBefore.id });
    const c = await book("10:00", "BOOKED", { patientId: returning.id });

    const { json } = await getBoard();
    const isNew = new Map((json as BoardResponse).items.map((row) => [row.id, row.isNew]));
    expect(isNew.get(a.id)).toBe(true);
    expect(isNew.get(b.id)).toBe(false);
    expect(isNew.get(c.id)).toBe(false);
  });

  it("버튼은 서버 시각으로 계산한 availableActions와 같다", async () => {
    const today = kstDateKey(new Date());
    // 오늘의 여러 시각 (지난 예약·곧 올 예약), 여러 상태
    const nowSlot = Math.floor(Date.now() / (5 * MINUTE)) * 5 * MINUTE;
    const startOfToday = kstDateTime(today, "00:00").getTime();
    const times = [startOfToday, Math.max(startOfToday, nowSlot - 10 * MINUTE), nowSlot, nowSlot + 60 * MINUTE].filter(
      (t) => kstDateKey(new Date(t)) === today,
    );
    const statuses: AppointmentStatus[] = ["BOOKED", "CONFIRMED", "ARRIVED", "NO_SHOW", "CANCELED_SAME_DAY", "PAID"];
    let chair = 0;
    for (const t of times) {
      for (const status of statuses) {
        await createAppointment({
          startAt: new Date(t),
          chair: `X${chair++}`,
          status,
          arrivedAt: ["ARRIVED", "PAID"].includes(status) ? new Date(t) : null,
        });
      }
    }

    const { status, json } = await getBoard("");
    expect(status).toBe(200);
    const board = json as BoardResponse;
    expect(board.date).toBe(today);
    expect(board.items).toHaveLength(times.length * statuses.length);
    const now = new Date(board.serverNow);
    for (const row of board.items) {
      const expected = availableActions({
        status: row.status,
        startAt: new Date(row.startAt),
        now,
        noShowGraceMin: DEFAULT_CLINIC_SETTINGS.noShowGraceMin,
      });
      expect(row.actions).toEqual(expected.actions);
      expect(row.noShowAllowedAt).toBe(expected.noShowAllowedAt?.toISOString() ?? null);
      expect(row.cancelTo).toBe("CANCELED_SAME_DAY");
    }
  });

  it("프론트가 읽을 수 있고 감사 행(BOARD_READ)이 남는다", async () => {
    // 환자 2명, 예약 3건
    const one = await book("10:00", "BOOKED");
    await book("11:00", "BOOKED");
    await book("12:00", "BOOKED", { patientId: one.patientId });

    const { status } = await getBoard();
    expect(status).toBe(200);
    const rows = await db.auditLog.findMany({ where: { action: "BOARD_READ" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ staffId: front.staff.id, result: "SUCCESS", patientId: null });
    expect(rows[0].detail).toEqual({ patientCount: 2, appointmentCount: 3 });
  });

  it("완료 기준: 프론트가 보드 행의 [내원]을 한 번(요청 1건) 누르면 저장되고, 지각은 자동 판정된다", async () => {
    // 허용시간(30분)보다 늦게 도착한 예약: 지금보다 45분 이상 전
    const startAt = new Date(Math.floor((Date.now() - 45 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE);
    const date = kstDateKey(startAt);
    const patient = await createPatient();
    const created = await createAppointmentService(
      { patientId: patient.id, startAt, durationMin: 30, chair: "C1", treatmentItem: "정기검진", channel: "PHONE" },
      { actorId: front.staff.id },
    );

    const before = (await getBoard(`?date=${date}`)).json as BoardResponse;
    const row = before.items.find((item) => item.id === created.id)!;
    expect(row.actions).toContain("ARRIVE");

    // 화면의 [내원] 클릭 = 이 요청 하나 (확인 창 없음)
    const click = await callRoute(statusRoute, {
      method: "POST",
      url: `/api/appointments/${row.id}/status`,
      cookie: front.cookie,
      params: { id: row.id },
      body: { to: "ARRIVED", expectedStatus: row.status },
    });
    expect(click.status).toBe(200);
    expect(click.json.isLate).toBe(true);

    const after = (await getBoard(`?date=${date}`)).json as BoardResponse;
    expect(after.items.find((item) => item.id === row.id)).toMatchObject({
      status: "ARRIVED",
      isLate: true,
      statusLabel: "지각내원",
    });
    expect(after.items.find((item) => item.id === row.id)?.actions).toContain("REVERT");
    expect(await db.visitStatusLog.count({ where: { appointmentId: row.id, toStatus: "ARRIVED" } })).toBe(1);

    // 5초 되돌리기 = revert 요청 하나
    const undo = await callRoute(revertRoute, {
      method: "POST",
      url: `/api/appointments/${row.id}/revert`,
      cookie: front.cookie,
      params: { id: row.id },
      body: { expectedStatus: "ARRIVED" },
    });
    expect(undo.status).toBe(200);
    const reverted = (await getBoard(`?date=${date}`)).json as BoardResponse;
    expect(reverted.items.find((item) => item.id === row.id)).toMatchObject({ status: "BOOKED", isLate: false });
  });

  it("모든 직원 역할이 읽을 수 있고, 로그인하지 않으면 401", async () => {
    for (const role of ["COUNSELOR", "DOCTOR", "ADMIN"] as const) {
      const { cookie } = await loginAs(role);
      expect((await getBoard(`?date=${DAY}`, cookie)).status).toBe(200);
    }
    expect((await callRoute(boardRoute, { url: `/api/board?date=${DAY}` })).status).toBe(401);
  });

  it("날짜 형식이 틀리면 400", async () => {
    expect((await getBoard("?date=2026-02-30")).status).toBe(400);
    expect((await getBoard("?date=today")).status).toBe(400);
  });

  it("응답에 전체 이름·전화번호가 없다 (마스킹한 이름만)", async () => {
    const patient = await createPatient({ name: "가상고객", ...sealPhone("010-0123-4567") });
    await book("10:00", "BOOKED", { patientId: patient.id });

    const { json, text } = await getBoard();
    expect((json as BoardResponse).items[0].nameMasked).toBe("가**객");
    expect(text).not.toContain("가상고객");
    expect(text).not.toContain("01001234567");
    expect(text).not.toContain("0123-4567");
    // 전화번호·전체 이름을 담는 필드 자체가 없다
    const keys = Object.keys((json as BoardResponse).items[0]);
    expect(keys.filter((key) => /phone/i.test(key) || key === "name" || key === "patientName")).toEqual([]);
  });
});
