"use client";

import { useState } from "react";
import type { ClinicSettings } from "@/lib/domain/clinic";
import { cn, Spinner } from "@/components/ui";
import type { CalendarStyle } from "@/components/calendar/calendar-style";
import { CalendarStyleEditor } from "@/components/calendar/calendar-style-editor";
import { TreatmentItemsEditor } from "@/components/calendar/treatment-items-editor";
import { ChairsEditor } from "./chairs-editor";
import { ClinicRulesEditor } from "./clinic-rules-editor";
import { StaffEditor } from "./staff-editor";

const SECTIONS = [
  { key: "items", label: "예약 항목" },
  { key: "labels", label: "색 라벨" },
  { key: "statuses", label: "상태 표시" },
  { key: "chairs", label: "체어·열" },
  { key: "rules", label: "진료시간·기준" },
  { key: "staff", label: "직원" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

/** 캘린더 [편집] 탭 (F-14) — 왼쪽 하위 메뉴, 오른쪽 한 가지씩. 관리자만(서버가 settings.write·staff.manage로 막는다). */
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
  const [section, setSection] = useState<SectionKey>("items");
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start">
      <nav aria-label="편집 메뉴" className="flex shrink-0 flex-row flex-wrap gap-1 md:w-36 md:flex-col">
        {SECTIONS.map((s) => (
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
        {section === "staff" && <StaffEditor onSaved={onSaved} />}
      </div>
    </div>
  );
}
