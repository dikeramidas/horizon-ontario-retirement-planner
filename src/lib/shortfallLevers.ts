/**
 * A7 — Suggested plan levers when the expected path is short or MC success is weak.
 * Pure functions: build alternate HouseholdInput patches the UI can apply.
 */
import type { HouseholdInput } from "../simulate";
import type { SimulationResult } from "../simulate";
import type { MonteCarloResult } from "../mc";

export interface ShortfallLever {
  id: string;
  label: string;
  detail: string;
  /** Safe to one-click apply into the form. */
  apply: (input: HouseholdInput) => HouseholdInput;
}

export function needsShortfallHelp(
  det: SimulationResult | null | undefined,
  mc: MonteCarloResult | null | undefined,
  successThreshold = 0.85
): boolean {
  if (det?.failedAnyYear) return true;
  if (mc && mc.successRate < successThreshold) return true;
  return false;
}

export function suggestShortfallLevers(
  input: HouseholdInput,
  det: SimulationResult | null | undefined,
  mc: MonteCarloResult | null | undefined
): ShortfallLever[] {
  const levers: ShortfallLever[] = [];
  const spend = input.spendingTargetToday;

  levers.push({
    id: "spend-5",
    label: "Cut lifestyle 5%",
    detail: `Lower annual spend from ${Math.round(spend).toLocaleString("en-CA")} to ${Math.round(spend * 0.95).toLocaleString("en-CA")} (today’s $).`,
    apply: (h) => ({ ...h, spendingTargetToday: Math.max(1_000, Math.round(h.spendingTargetToday * 0.95)) }),
  });

  levers.push({
    id: "spend-10",
    label: "Cut lifestyle 10%",
    detail: `More aggressive: spend ${Math.round(spend * 0.9).toLocaleString("en-CA")}/yr (today’s $).`,
    apply: (h) => ({ ...h, spendingTargetToday: Math.max(1_000, Math.round(h.spendingTargetToday * 0.9)) }),
  });

  levers.push({
    id: "retire-plus-1",
    label: "Delay both retirements 1 year",
    detail: "Work one more year for each spouse (more salary / savings, later drawdown).",
    apply: (h) => {
      const persons = h.persons.map((p) => ({
        ...p,
        retirementAge: Math.min(75, (p.retirementAge ?? 65) + 1),
      })) as HouseholdInput["persons"];
      return { ...h, persons };
    },
  });

  const curC = input.strategy?.topUpCeilingToday ?? 0;
  levers.push({
    id: "ceiling-nudge",
    label: curC > 0 ? "Raise top-up ceiling $10k" : "Enable modest meltdown ($60k C)",
    detail:
      curC > 0
        ? "Slightly higher RRSP/RRIF top-up room can change tax timing (re-run full plan to re-optimize)."
        : "Set a $60k taxable-income top-up ceiling as a starting point, then re-run full plan.",
    apply: (h) => ({
      ...h,
      strategy: {
        ...(h.strategy ?? {}),
        topUpCeilingToday: curC > 0 ? curC + 10_000 : 60_000,
      },
    }),
  });

  levers.push({
    id: "horizon-trim",
    label: "Plan to age 90 (younger spouse)",
    detail: "Shorter horizon reduces years of spending (not a longevity recommendation).",
    apply: (h) => ({
      ...h,
      horizonAgeYoungerSpouse: Math.min(h.horizonAgeYoungerSpouse ?? 95, 90),
    }),
  });

  // Context note in ranking: put spend cuts first if det failed early
  if (det?.failedAnyYear && det.firstFailureYear != null) {
    // already ordered with spend first
  }
  if (mc && mc.successRate < 0.85 && !det?.failedAnyYear) {
    // MC weak but det funded — keep spend and retire delay high; ceiling still useful
  }

  return levers;
}
