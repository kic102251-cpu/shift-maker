/* ── Shift Types ── */
export type ShiftType =
  | "day"         // 日勤
  | "night"       // 夜勤 (concept only: used in reqs/targets, never in assignments)
  | "semi_night"  // 準夜 (assignment)
  | "deep_night"  // 深夜 (assignment)
  | "off"         // 休み
  | "early"       // 早番
  | "late"        // 遅番
  | "long_day"    // 日長
  | "standby"     // 待機
  | "training"    // 研修
  | "annual"      // 年休
  | "am"          // 午前
  | "pm"          // 午後
  | "req_off";    // 希望休 (internal)

/** User-facing toggleable shifts (shown in toggle row) */
export const ALL_SHIFTS: ShiftType[] = [
  "day","night","off","early","late","long_day","standby","training","annual","am","pm",
];

export type ToggleableShift = Exclude<ShiftType, "req_off" | "semi_night" | "deep_night">;
export const TOGGLEABLE_SHIFTS: ToggleableShift[] = ALL_SHIFTS as ToggleableShift[];

/** Shifts that can appear in actual assignments */
export const ASSIGNABLE_SHIFTS: ShiftType[] = [
  "day","semi_night","deep_night","off","early","late","long_day",
  "standby","training","annual","am","pm","req_off",
];

/** Shifts with per-staff target counts */
export const TARGET_SHIFTS: ShiftType[] = [
  "day","night","early","late","long_day","standby","training","annual","am","pm",
];

/** Day-work shifts (counted in daily worker total; excludes night shifts) */
export const WORK_SHIFTS: ShiftType[] = [
  "day","early","late","long_day","standby","training","am","pm",
];

export const SHIFT_LABELS: Record<ShiftType, string> = {
  day:"日勤", night:"夜勤", semi_night:"準夜", deep_night:"深夜",
  off:"休み", early:"早番", late:"遅番", long_day:"日長",
  standby:"待機", training:"研修", annual:"年休",
  am:"午前", pm:"午後", req_off:"希休",
};

export const SHIFT_SHORT: Record<ShiftType, string> = {
  day:"日", night:"夜", semi_night:"準", deep_night:"深",
  off:"休", early:"早", late:"遅", long_day:"長",
  standby:"待", training:"研", annual:"年",
  am:"前", pm:"後", req_off:"希",
};

export const SHIFT_COLORS: Record<ShiftType, string> = {
  day:        "bg-sky-50 text-sky-700 border-sky-200",
  night:      "bg-indigo-50 text-indigo-700 border-indigo-200",
  semi_night: "bg-indigo-50 text-indigo-700 border-indigo-200",
  deep_night: "bg-violet-50 text-violet-700 border-violet-200",
  off:        "bg-gray-50 text-gray-400 border-gray-200",
  early:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  late:       "bg-amber-50 text-amber-700 border-amber-200",
  long_day:   "bg-rose-50 text-rose-700 border-rose-200",
  standby:    "bg-yellow-50 text-yellow-700 border-yellow-200",
  training:   "bg-cyan-50 text-cyan-700 border-cyan-200",
  annual:     "bg-pink-50 text-pink-600 border-pink-200",
  am:         "bg-lime-50 text-lime-700 border-lime-200",
  pm:         "bg-orange-50 text-orange-700 border-orange-200",
  req_off:    "bg-pink-100 text-pink-700 border-pink-300",
};

export const SHIFT_BG: Record<ShiftType, string> = {
  day:"bg-sky-100", night:"bg-indigo-100",
  semi_night:"bg-indigo-100", deep_night:"bg-violet-100",
  off:"bg-gray-100", early:"bg-emerald-100", late:"bg-amber-100",
  long_day:"bg-rose-100", standby:"bg-yellow-100", training:"bg-cyan-100",
  annual:"bg-pink-100", am:"bg-lime-100", pm:"bg-orange-100", req_off:"bg-pink-200",
};

export const SHIFT_TEXT: Record<ShiftType, string> = {
  day:"text-sky-700", night:"text-indigo-700",
  semi_night:"text-indigo-700", deep_night:"text-violet-700",
  off:"text-gray-400", early:"text-emerald-700", late:"text-amber-700",
  long_day:"text-rose-700", standby:"text-yellow-700", training:"text-cyan-700",
  annual:"text-pink-600", am:"text-lime-700", pm:"text-orange-700", req_off:"text-pink-700",
};

export const DEFAULT_ENABLED: Record<ToggleableShift, boolean> = {
  day:true, night:true, off:true,
  early:false, late:false, long_day:false, standby:false, training:false, annual:false,
  am:false, pm:false,
};

/* ── Per-staff shift targets ── */
export type ShiftTargets = Partial<Record<ShiftType, number>>;
export const DEFAULT_TARGETS: ShiftTargets = { day:14, night:2 };

/* ── Attendance & Employment ── */
export type AttendancePattern = "full" | "weekday_only" | "custom";
export type EmploymentType = "fulltime" | "part" | "short";

export const ATTENDANCE_LABELS: Record<AttendancePattern, string> = {
  full: "通常（全日出勤可）",
  weekday_only: "平日のみ（土日祝休み）",
  custom: "カスタム",
};
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  fulltime: "常勤", part: "パート", short: "時短",
};
export const EMPLOYMENT_BADGE: Record<EmploymentType, string> = {
  fulltime: "", part: "パート", short: "時短",
};

/* ── Staff ── */
export interface Staff {
  id: string;
  name: string;
  monthlyOffDays: number;
  targets: ShiftTargets;
  attendance: AttendancePattern;
  customDays: boolean[];
  employment: EmploymentType;
}

/* ── Preference ── */
export interface ShiftPreference {
  staffId: string;
  date: string;
  shift: ShiftType; // "night" means night set, "off" etc
}

/* ── Assignment ── */
export interface ShiftAssignment {
  staffId: string;
  date: string;
  shift: ShiftType; // actual: semi_night, deep_night, day, off, etc (never "night")
  manual?: boolean;
}

/* ── Daily requirement ── */
export type DailyRequirement = Partial<Record<ShiftType, number>>;

export const WEEKDAY_TEMPLATE: DailyRequirement = { day:5, night:2 };
export const WEEKEND_TEMPLATE: DailyRequirement = { day:3, night:2 };

/* ── Config ── */
export interface ShiftConfig {
  enabledShifts: Record<ToggleableShift, boolean>;
}
export const DEFAULT_CONFIG: ShiftConfig = { enabledShifts:{...DEFAULT_ENABLED} };

/* ── Confirmed month data (for carryover & reports) ── */
export type StaffCounts = Record<string, number>; // shiftType -> count
export type ConfirmedData = Record<string, StaffCounts>; // staffId -> counts

/* ── Warnings ── */
export interface ShiftWarning {
  level: "error" | "warn";
  message: string;
}

/* ── Carryover: per-staff target adjustments ── */
export type Carryover = Record<string, Record<string, number>>; // staffId -> shiftType -> delta
