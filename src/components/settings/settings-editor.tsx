"use client";

import { useState } from "react";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { cn, Spinner } from "@/components/ui";
import type { CalendarStyle } from "@/components/calendar/calendar-style";
import { CalendarStyleEditor } from "@/components/calendar/calendar-style-editor";
import { TreatmentItemsEditor } from "@/components/calendar/treatment-items-editor";
import { ChairsEditor } from "./chairs-editor";
import { ClinicRulesEditor } from "./clinic-rules-editor";
import { ConsultOutcomesEditor } from "./consult-outcomes-editor";
import { DepartmentHomesEditor } from "./department-homes-editor";
import { StaffEditor } from "./staff-editor";
import { useAccess } from "@/components/auth/access";
import { ImportScreen } from "@/components/import/import-screen";
import type { ScreenArea } from "@/lib/auth/screen-registry";

/** 하위 메뉴마다 화면 등록부의 영역 — 그 권한이 있는 메뉴만 보인다 */
const SECTIONS = [
  { key: "items", label: "예약 항목", area: "calendar.settings" },
  { key: "labels", label: "색 라벨", area: "calendar.settings" },
  { key: "statuses", label: "상태 표시", area: "calendar.settings" },
  { key: "chairs", label: "체어·열", area: "calendar.settings" },
  { key: "consult", label: "상담 결과", area: "calendar.settings" },
  { key: "rules", label: "진료시간·기준", area: "calendar.settings" },
  { key: "homes", label: "부서별 첫 화면", area: "calendar.settings" },
  { key: "staff", label: "직원", area: "settings.staff" },
  { key: "import", label: "가져오기", area: "settings.import" },
] as const satisfies ReadonlyArray<{ key: string; label: string; area: ScreenArea }>;
type SectionKey = (typeof SECTIONS)[number]["key"];

/**
 * 캘린더 [편집] 탭 (F-14) — 왼쪽 하위 메뉴, 오른쪽 한 가지씩. 하위 메뉴는 권한별로 보인다(화면 등록부).
 * 실제 차단은 각 API(settings.write·staff.manage·data.import)가 한다. [가져오기]는 S-4 보완에서 상단 메뉴에서 옮겨 왔다.
 */
export function SettingsEditor({
  settings,
  style,
  styleReady,
  onSaved,
}: {
  settings: ClinicSettings;
  style: CalendarStyle;
  styleReady: boolean;
  onSaved: (message: string) => void;
}) {
  const { allows } = useAccess();
  const visible = SECTIONS.filter((s) => allows(s.area));
  const [chosen, setSection] = useState<SectionKey | null>(null);
  const section = visible.some((s) => s.key === chosen) ? chosen : (visible[0]?.key ?? null);
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start">
      <nav aria-label="편집 메뉴" className="flex shrink-0 flex-row flex-wrap gap-1 md:w-36 md:flex-col">
        {visible.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-current={section === s.key ? "page" : undefined}
            onClick={() => setSection(s.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-left text-sm font-semibold",
              section === s.key ? "bg-blue-700 text-white" : "bg-white text-slate-700 hover:bg-slate-100",
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {/* 편집 화면은 관리자 PC용이라 입력칸·버튼을 낮게(촘촘하게) 보인다 */}
      <div className="min-w-0 flex-1 text-sm [&_button]:min-h-9 [&_input]:min-h-9 [&_input]:py-1 [&_select]:min-h-9 [&_select]:py-1 [&_li]:gap-1.5">
        {section === "items" && <TreatmentItemsEditor key={JSON.stringify(settings.treatmentItemMeta)} settings={settings} onSaved={onSaved} />}
        {(section === "labels" || section === "statuses") &&
          (styleReady ? <CalendarStyleEditor style={style} onSaved={onSaved} section={section} /> : <Spinner showLabel />)}
        {section === "chairs" && <ChairsEditor key={JSON.stringify(settings.chairs)} settings={settings} onSaved={onSaved} />}
        {section === "rules" && <ClinicRulesEditor settings={settings} onSaved={onSaved} />}
        {section === "consult" && <ConsultOutcomesEditor onSaved={onSaved} />}
        {section === "staff" && <StaffEditor onSaved={onSaved} />}
        {section === "homes" && <DepartmentHomesEditor onSaved={onSaved} />}
        {section === "import" && <ImportScreen />}
      </div>
    </div>
  );
}
