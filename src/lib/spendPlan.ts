/** B8 — resolve lifestyle spend (phases + one-time goals) in today’s $. */
import type { HouseholdInput, OneTimeGoal, SpendPhase } from "../simulate";

export function baseSpendToday(input: HouseholdInput, youngerAge: number): number {
  const phases = input.spendPhases;
  if (!phases?.length) return input.spendingTargetToday;
  const sorted = [...phases].sort((a, b) => a.fromAgeYounger - b.fromAgeYounger);
  let spend = input.spendingTargetToday;
  for (const p of sorted) {
    if (youngerAge >= p.fromAgeYounger) spend = p.spendToday;
  }
  return spend;
}

export function oneTimeSpendToday(goals: OneTimeGoal[] | undefined, year: number): number {
  if (!goals?.length) return 0;
  return goals.filter((g) => g.year === year).reduce((s, g) => s + Math.max(0, g.amountToday), 0);
}

/** Nominal spending target for a calendar year (before survivor step-down). */
export function nominalSpendTarget(
  input: HouseholdInput,
  year: number,
  cpi: number,
  youngerAge: number
): number {
  const base = baseSpendToday(input, youngerAge);
  const oneTime = oneTimeSpendToday(input.oneTimeGoals, year);
  return (base + oneTime) * cpi;
}

export function normalizePhases(phases: SpendPhase[] | undefined): SpendPhase[] {
  if (!phases?.length) return [];
  return [...phases]
    .filter((p) => Number.isFinite(p.fromAgeYounger) && Number.isFinite(p.spendToday))
    .sort((a, b) => a.fromAgeYounger - b.fromAgeYounger);
}
