import { ShiftAssignment, Staff, ShiftWarning, WORK_SHIFTS } from "./types";

/**
 * Validate shift assignments and return warnings.
 * Called after generation and on every manual edit.
 */
export function checkShift(
  staffList: Staff[],
  assignments: ShiftAssignment[],
  year: number,
  month: number,
): ShiftWarning[] {
  const warnings: ShiftWarning[] = [];
  const numDays = new Date(year, month, 0).getDate();
  const mp = `${year}-${String(month).padStart(2, "0")}`;
  const fmt = (d: number) => `${mp}-${String(d).padStart(2, "0")}`;

  // Build lookup: staffId -> day -> shift
  const grid = new Map<string, Map<number, string>>();
  for (const s of staffList) grid.set(s.id, new Map());
  for (const a of assignments) {
    if (!a.date.startsWith(mp)) continue;
    const d = parseInt(a.date.split("-")[2]);
    grid.get(a.staffId)?.set(d, a.shift);
  }

  const nameMap = new Map(staffList.map(s => [s.id, s.name]));
  const isWork = (sh: string | undefined) =>
    sh !== undefined && sh !== "off" && sh !== "req_off" && sh !== "annual";

  for (const s of staffList) {
    const row = grid.get(s.id);
    if (!row) continue;
    const name = s.name;

    // 1. Consecutive work days >= 6
    let streak = 0;
    let streakStart = 0;
    for (let d = 1; d <= numDays; d++) {
      if (isWork(row.get(d))) {
        if (streak === 0) streakStart = d;
        streak++;
      } else {
        if (streak >= 6) {
          warnings.push({
            level: streak >= 7 ? "error" : "warn",
            message: `${name}さんが${month}/${streakStart}〜${month}/${streakStart + streak - 1}で${streak}日間の連続勤務になっています`,
          });
        }
        streak = 0;
      }
    }
    if (streak >= 6) {
      warnings.push({
        level: streak >= 7 ? "error" : "warn",
        message: `${name}さんが${month}/${streakStart}〜${month}/${streakStart + streak - 1}で${streak}日間の連続勤務になっています`,
      });
    }

    // 2. deep_night followed by non-off
    for (let d = 1; d < numDays; d++) {
      if (row.get(d) === "deep_night") {
        const next = row.get(d + 1);
        if (next && next !== "off" && next !== "req_off") {
          warnings.push({
            level: "error",
            message: `${name}さんの${month}/${d + 1}は深夜明けのため休みが望ましいですが、${shiftLabel(next)}が入っています`,
          });
        }
      }
    }

    // 3. semi_night not followed by deep_night
    for (let d = 1; d < numDays; d++) {
      if (row.get(d) === "semi_night") {
        const next = row.get(d + 1);
        if (next !== "deep_night") {
          warnings.push({
            level: "error",
            message: `${name}さんの${month}/${d}に準夜が入っていますが、翌日が深夜になっていません（通常は準夜→深夜→休みのセットです）`,
          });
        }
      }
    }
    // semi_night on last day
    if (row.get(numDays) === "semi_night") {
      warnings.push({
        level: "error",
        message: `${name}さんの${month}/${numDays}（月末最終日）に準夜が入っています。翌月への影響をご確認ください`,
      });
    }

    // 4. Night count deviation from target (±2)
    const nightTarget = s.targets?.night || 0;
    let semiCount = 0;
    for (let d = 1; d <= numDays; d++) {
      if (row.get(d) === "semi_night") semiCount++;
    }
    const diff = semiCount - nightTarget;
    if (Math.abs(diff) >= 2) {
      warnings.push({
        level: Math.abs(diff) >= 3 ? "error" : "warn",
        message: `${name}さんの夜勤回数が目標と${Math.abs(diff)}回ずれています（目標${nightTarget}回 → 今月${semiCount}回）`,
      });
    }
  }

  return warnings;
}

function shiftLabel(sh: string): string {
  const labels: Record<string, string> = {
    day: "日勤", semi_night: "準夜", deep_night: "深夜", off: "休み",
    early: "早番", late: "遅番", long_day: "日長", standby: "待機",
    training: "研修", annual: "年休", am: "午前", pm: "午後", req_off: "希休",
  };
  return labels[sh] || sh;
}
