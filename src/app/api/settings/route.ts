import { defineRoute } from "@/server/api/define-route";
import { getClinicSettings } from "@/server/appointments/settings";

/** 병원 설정 (체어·예약 항목·진료시간·지각/노쇼 기준) — 예약 화면과 내원 보드가 쓴다. 환자 정보가 없어 감사 행은 없다. */
export const GET = defineRoute({
  permission: "settings.read",
  audit: "none",
  handler: () => getClinicSettings(),
});
