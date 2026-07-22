/**
 * B4 — Side-by-side scenario metrics (deterministic analyzePlan path).
 */
import type { HouseholdInput, SimulationResult } from "../simulate";
import { analyzePlan, type AnalysisOptions, type PlanAnalysis } from "./analysis";
import { householdNetWorth } from "./cashflow";
import { estateTaxOf } from "./estateTax";
import { resolveTfsaLevel } from "./tfsaPolicy";

export interface ScenarioSideInput {
  id: string;
  label: string;
  inputs: HouseholdInput;
}

export interface ScenarioSideMetrics {
  id: string;
  label: string;
  spendingTargetToday: number;
  retirementAges: [number, number];
  personNames: [string, string];
  horizonAgeYoungerSpouse: number;
  inflation: number;
  bestCeilingToday: number;
  tfsaLevel: string;
  tfsaReserveYears: number;
  funded: boolean;
  firstFailureYear?: number;
  lifetimeTax: number;
  estateTax: number;
  estateReal: number;
  totalTaxSaving: number;
  estateRealGain: number;
  /** Real household net worth by calendar year (for dual chart). */
  netWorthRealByYear: Array<{ year: number; value: number }>;
  analysis: PlanAnalysis;
}

export interface ScenarioCompareResult {
  left: ScenarioSideMetrics;
  right: ScenarioSideMetrics;
  deltas: {
    spending: number;
    ceiling: number;
    lifetimeTax: number;
    estateTax: number;
    estateReal: number;
    estateRealGain: number;
  };
}

function seriesFromPrimary(primary: SimulationResult): Array<{ year: number; value: number }> {
  return primary.rows.map((r) => ({
    year: r.year,
    value: householdNetWorth(r) / r.cpiIndex,
  }));
}

export function metricsFromAnalysis(
  side: ScenarioSideInput,
  analysis: PlanAnalysis
): ScenarioSideMetrics {
  const h = side.inputs;
  const primary = analysis.primary;
  return {
    id: side.id,
    label: side.label,
    spendingTargetToday: h.spendingTargetToday,
    retirementAges: [h.persons[0].retirementAge, h.persons[1].retirementAge],
    personNames: [h.persons[0].name || "Spouse A", h.persons[1].name || "Spouse B"],
    horizonAgeYoungerSpouse: h.horizonAgeYoungerSpouse ?? 95,
    inflation: h.inflation ?? 0.021,
    bestCeilingToday: analysis.bestCeilingToday,
    tfsaLevel: resolveTfsaLevel(h.strategy?.tfsaLevel),
    tfsaReserveYears: h.strategy?.tfsaReserveYears ?? 2,
    funded: analysis.funded,
    firstFailureYear: primary.firstFailureYear,
    lifetimeTax: primary.lifetimeTax,
    estateTax: estateTaxOf(primary),
    estateReal: primary.afterTaxEstateReal,
    totalTaxSaving: analysis.totalTaxSaving,
    estateRealGain: analysis.estateRealGain,
    netWorthRealByYear: seriesFromPrimary(primary),
    analysis,
  };
}

/** Analyze both sides (quick by default) and build compare deltas (right − left). */
export function compareScenarios(
  left: ScenarioSideInput,
  right: ScenarioSideInput,
  opts: AnalysisOptions = { quick: true }
): ScenarioCompareResult {
  const { onProgress, ...rest } = opts;
  onProgress?.({ phase: "compare-left", fraction: 0.1, detail: `Analyzing ${left.label}…` });
  const aL = analyzePlan(left.inputs, {
    ...rest,
    onProgress: (p) =>
      onProgress?.({
        ...p,
        fraction: 0.1 + (p.fraction ?? 0) * 0.4,
        detail: p.detail ? `${left.label}: ${p.detail}` : undefined,
      }),
  });
  onProgress?.({ phase: "compare-right", fraction: 0.55, detail: `Analyzing ${right.label}…` });
  const aR = analyzePlan(right.inputs, {
    ...rest,
    onProgress: (p) =>
      onProgress?.({
        ...p,
        fraction: 0.55 + (p.fraction ?? 0) * 0.4,
        detail: p.detail ? `${right.label}: ${p.detail}` : undefined,
      }),
  });
  const L = metricsFromAnalysis(left, aL);
  const R = metricsFromAnalysis(right, aR);
  onProgress?.({ phase: "done", fraction: 1, detail: "Compare ready" });
  return {
    left: L,
    right: R,
    deltas: {
      spending: R.spendingTargetToday - L.spendingTargetToday,
      ceiling: R.bestCeilingToday - L.bestCeilingToday,
      lifetimeTax: R.lifetimeTax - L.lifetimeTax,
      estateTax: R.estateTax - L.estateTax,
      estateReal: R.estateReal - L.estateReal,
      estateRealGain: R.estateRealGain - L.estateRealGain,
    },
  };
}
