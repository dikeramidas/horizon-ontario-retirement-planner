/**
 * Persist the working plan across browser refresh (localStorage).
 * Named scenarios remain separate (scenarioStore); this is the "live form".
 */
import type { HouseholdInput } from "../simulate";
import { sampleHousehold } from "./sampleHousehold";

const KEY = "horizon:draft-v1";
export const DRAFT_SCHEMA = 1;

export interface PlanDraft {
  schemaVersion: number;
  savedAt: string;
  inputs: HouseholdInput;
  seed: number;
  mcTrials: number;
  defaultVol: number;
  scenarioName: string;
}

export function saveDraft(draft: Omit<PlanDraft, "schemaVersion" | "savedAt">): void {
  try {
    const full: PlanDraft = {
      schemaVersion: DRAFT_SCHEMA,
      savedAt: new Date().toISOString(),
      inputs: structuredClone(draft.inputs),
      seed: draft.seed,
      mcTrials: draft.mcTrials,
      defaultVol: draft.defaultVol,
      scenarioName: draft.scenarioName,
    };
    localStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    /* private mode / quota */
  }
}

export function loadDraft(): PlanDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as PlanDraft;
    if (d?.schemaVersion !== DRAFT_SCHEMA) return null;
    if (!d.inputs?.persons?.[0] || !d.inputs?.persons?.[1]) return null;
    if (!(d.inputs.spendingTargetToday > 0)) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Initial form state: restored draft or sample couple. */
export function initialPlanState(): {
  inputs: HouseholdInput;
  seed: number;
  mcTrials: number;
  defaultVol: number;
  scenarioName: string;
  restored: boolean;
} {
  const d = loadDraft();
  if (d) {
    return {
      inputs: structuredClone(d.inputs),
      seed: d.seed ?? 42,
      mcTrials: d.mcTrials ?? 400,
      defaultVol: d.defaultVol ?? 0.11,
      scenarioName: d.scenarioName || "Our plan",
      restored: true,
    };
  }
  return {
    inputs: sampleHousehold(),
    seed: 42,
    mcTrials: 400,
    defaultVol: 0.11,
    scenarioName: "Our plan",
    restored: false,
  };
}
