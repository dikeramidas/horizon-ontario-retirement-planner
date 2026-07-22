import type { HouseholdInput } from "../simulate";

const KEY = "horizon:last-plan-v1";

export interface LastPlanSnapshot {
  input: HouseholdInput;
  personNames: [string, string];
  savedAt: string;
}

export function saveLastPlan(input: HouseholdInput, personNames: [string, string]): void {
  try {
    const snap: LastPlanSnapshot = {
      input: structuredClone(input),
      personNames,
      savedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function loadLastPlan(): LastPlanSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LastPlanSnapshot;
    if (!s?.input?.persons?.[0] || !s?.input?.persons?.[1]) return null;
    return s;
  } catch {
    return null;
  }
}
