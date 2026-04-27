import {
  Staff, ShiftPreference, ShiftAssignment, ShiftConfig, DEFAULT_CONFIG,
  DailyRequirement, DEFAULT_TARGETS, ConfirmedData, CustomShift, SkillLevel,
} from "./types";

const PFX = "sm6";

function load<T>(key: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; }
  catch { return fb; }
}
function save(key: string, d: unknown) { localStorage.setItem(key, JSON.stringify(d)); }

function mkStaff(id: string, name: string): Staff {
  return {
    id, name, monthlyOffDays: 10, targets: { ...DEFAULT_TARGETS },
    attendance: "full", customDays: [true,true,true,true,true,true,true],
    employment: "fulltime",
  };
}

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXY".split("");
const DEF_STAFF: Staff[] = ALPHA.map((n, i) => mkStaff(String(i + 1), n));

/** Migrate raw localStorage data: fill optional fields introduced in newer versions */
function migrateStaff(raw: Staff[]): Staff[] {
  const validSkillLevels: SkillLevel[] = ["rookie", "mid", "leader"];
  return raw.map(s => ({
    ...s,
    // Phase 1 fields (experienceYears / canLead)
    experienceYears: s.experienceYears ?? 0,
    canLead:         s.canLead         ?? false,
    // Phase 2 field: skillLevel — default "mid" so existing staff stay stable
    skillLevel: validSkillLevels.includes(s.skillLevel as SkillLevel)
      ? s.skillLevel
      : "mid",
    // Ensure arrays are present
    customDays: Array.isArray(s.customDays) && s.customDays.length === 7
      ? s.customDays
      : [true,true,true,true,true,true,true],
  }));
}

export const loadStaff      = (): Staff[] => migrateStaff(load(`${PFX}-staff`, DEF_STAFF));
export const saveStaff      = (s: Staff[]) => save(`${PFX}-staff`, s);
export const loadPrefs      = () => load<ShiftPreference[]>(`${PFX}-prefs`, []);
export const savePrefs      = (p: ShiftPreference[]) => save(`${PFX}-prefs`, p);
export const loadAssignments= () => load<ShiftAssignment[]>(`${PFX}-assign`, []);
export const saveAssignments= (a: ShiftAssignment[]) => save(`${PFX}-assign`, a);
export const loadConfig     = () => load(`${PFX}-config`, DEFAULT_CONFIG);
export const saveConfig     = (c: ShiftConfig) => save(`${PFX}-config`, c);
export const loadDailyReqs  = () => load<Record<string,DailyRequirement>>(`${PFX}-dreqs`, {});
export const saveDailyReqs  = (r: Record<string,DailyRequirement>) => save(`${PFX}-dreqs`, r);

/* ── Confirmed month data ── */
export const loadConfirmed = (ym: string): ConfirmedData => load(`${PFX}-conf-${ym}`, {});
export const saveConfirmed = (ym: string, data: ConfirmedData) => save(`${PFX}-conf-${ym}`, data);
export const loadConfirmedMonths = (): string[] => load<string[]>(`${PFX}-conf-list`, []);
export const saveConfirmedMonths = (months: string[]) => save(`${PFX}-conf-list`, months);
export const deleteConfirmed = (ym: string) => {
  if (typeof window !== "undefined") localStorage.removeItem(`${PFX}-conf-${ym}`);
};

/* ── Custom shifts ── */
export const loadCustomShifts = (): CustomShift[] => load<CustomShift[]>(`${PFX}-cshifts`, []);
export const saveCustomShifts = (cs: CustomShift[]) => save(`${PFX}-cshifts`, cs);
