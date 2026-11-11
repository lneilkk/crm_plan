/**
 * 병원 설정 — 기획서 6장("병원 설정 테이블에 허용 지각 시간, 노쇼 유예 시간을 둔다"), T4-4 기준.
 * clinic_setting 테이블(1행)에 저장되는 값의 형태다.
 */

/** 예약을 넣을 수 있는 자리. 캘린더의 열이 된다. */
export type Chair = {
  /** 예약에 저장되는 코드 (예: "C1"). 한 번 쓰기 시작하면 바꾸지 않는다. */
  code: string;
  /** 화면 표시 이름 (예: "체어 1", "상담실") */
  name: string;
  kind: "CHAIR" | "CONSULT_ROOM";
};

/** 요일별 진료시간. 키는 0=일 … 6=토, 값이 null이면 휴진. 시각은 한국 시간 "HH:mm". */
export type BusinessHours = Record<
  "0" | "1" | "2" | "3" | "4" | "5" | "6",
  { open: string; close: string } | null
>;

export type ClinicSettings = {
  /** 지각 허용시간(분). 내원 입력 시각이 예약 시각 + 이 값을 넘으면 '지각내원'. 기획서 예시 15분 */
  lateToleranceMin: number;
  /** 노쇼 유예시간(분). 예약 시각 + 이 값이 지나야 노쇼 처리 가능. 기획서 기본 30분 */
  noShowGraceMin: number;
  businessHours: BusinessHours;
  chairs: Chair[];
  /** 예약 항목(진료 항목) 목록 — 예약 분류용 이름이며 진료기록이 아니다 */
  treatmentItems: string[];
};

export const DEFAULT_LATE_TOLERANCE_MIN = 15;
export const DEFAULT_NO_SHOW_GRACE_MIN = 30;

/**
 * 병원 기본 설정. 시드(T1-4)와 가짜 데이터 생성(T0-5)이 같이 쓴다.
 * 실제 값은 병원 설정 화면(T4-4)에서 바꾼다.
 */
export const DEFAULT_CLINIC_SETTINGS: ClinicSettings = {
  lateToleranceMin: DEFAULT_LATE_TOLERANCE_MIN,
  noShowGraceMin: DEFAULT_NO_SHOW_GRACE_MIN,
  businessHours: {
    "0": null, // 일요일 휴진
    "1": { open: "09:30", close: "18:30" },
    "2": { open: "09:30", close: "18:30" },
    "3": { open: "09:30", close: "18:30" },
    "4": { open: "09:30", close: "18:30" },
    "5": { open: "09:30", close: "18:30" },
    "6": { open: "09:30", close: "14:00" },
  },
  chairs: [
    { code: "C1", name: "체어 1", kind: "CHAIR" },
    { code: "C2", name: "체어 2", kind: "CHAIR" },
    { code: "C3", name: "체어 3", kind: "CHAIR" },
    { code: "C4", name: "체어 4", kind: "CHAIR" },
    { code: "R1", name: "상담실", kind: "CONSULT_ROOM" },
  ],
  treatmentItems: ["정기검진", "스케일링", "충치 치료", "신경 치료", "발치", "임플란트", "교정", "보철", "미백", "상담"],
};
