import { defineRoute } from "@/server/api/define-route";
import { getClinicSettings } from "@/server/appointments/settings";
import { treatmentMetaForViewer } from "@/server/appointments/price";
import { getDepartmentHomes } from "@/server/settings/department-homes";

/** 병원 설정 (체어·예약 항목·진료시간·지각/노쇼 기준) — 예약 화면과 내원 보드가 쓴다. 환자 정보가 없어 감사 행은 없다. */
export const GET = defineRoute({
  permission: "settings.read",
  audit: "none",
  handler: async (ctx) => {
    const settings = await getClinicSettings();
    // 예약 항목 단가는 금액 권한이 있는 사람에게만 (S-3)
    return {
      ...settings,
      treatmentItemMeta: treatmentMetaForViewer(ctx.staff, settings.treatmentItemMeta),
      /** 부서별 첫 화면 (S-4) */
      departmentHomes: await getDepartmentHomes(),
    };
  },
});
