/**
 * Stochastic longevity — Monte Carlo over independent death ages.
 * Pins tax strategy from the household; uses fast solver for trials.
 */
import { simulate, type HouseholdInput } from "../simulate";
import { mulberry32, deriveSeed } from "../mc";
import type { ProgressCallback } from "./progress";
import {
  householdBothLive,
  householdWithFirstDeath,
  planEndYear,
  planStartYear,
} from "./longevityScenarios";
import { sampleCoupleDeaths } from "./mortality";

export interface StochasticLongevityOptions {
  trials?: number;
  seed?: number;
  survivorSpendFrac?: number;
  onProgress?: ProgressCallback;
}

export interface StochasticLongevityResult {
  trials: number;
  seed: number;
  survivorSpendFrac: number;
  personNames: [string, string];
  startYear: number;
  planEndYear: number;
  /** Share of trials with no spending shortfall. */
  successRate: number;
  /** Share of trials with an in-plan first death. */
  inPlanDeathRate: number;
  /** Among in-plan deaths, share where person 0 dies first. */
  person0FirstShare: number;
  estateReal: { p10: number; p50: number; p90: number; mean: number };
  firstDeathAge: { p10: number; p50: number; p90: number; mean: number } | null;
  /** Deterministic both-live estate (same pins) for comparison. */
  baselineEstateReal: number;
  baselineFunded: boolean;
  elapsedMs: number;
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stats(xs: number[]): { p10: number; p50: number; p90: number; mean: number } {
  const s = [...xs].sort((a, b) => a - b);
  return {
    p10: percentileSorted(s, 0.1),
    p50: percentileSorted(s, 0.5),
    p90: percentileSorted(s, 0.9),
    mean: mean(xs),
  };
}

/**
 * Run N mortality trials with strategy pins held fixed.
 * Default 300 trials for snappy UI; use seed for reproducibility.
 */
export function runStochasticLongevity(
  base: HouseholdInput,
  opts: StochasticLongevityOptions = {}
): StochasticLongevityResult {
  const trials = Math.max(20, Math.min(2_000, Math.floor(opts.trials ?? 300)));
  const seed = opts.seed ?? 1;
  const survivorSpendFrac =
    opts.survivorSpendFrac ?? base.survivorship?.survivorSpendFrac ?? 0.7;
  const startYear = planStartYear(base);
  const endYear = planEndYear(base);
  const names: [string, string] = [
    base.persons[0].name || "Spouse A",
    base.persons[1].name || "Spouse B",
  ];
  const births: [number, number] = [
    base.persons[0].birthYear,
    base.persons[1].birthYear,
  ];

  const t0 = performance.now();
  opts.onProgress?.({ phase: "baseline", fraction: 0.02, detail: "Baseline both-live…" });

  const baselineH = householdBothLive(base);
  baselineH.solverQuality = "fast";
  const baseline = simulate(baselineH);

  const estates: number[] = [];
  const firstDeathAges: number[] = [];
  let funded = 0;
  let inPlanDeaths = 0;
  let person0First = 0;

  for (let t = 0; t < trials; t++) {
    const rng = mulberry32(deriveSeed(seed, t + 17));
    const deaths = sampleCoupleDeaths(births, startYear, endYear, rng);

    let h: HouseholdInput;
    if (deaths.hasInPlanDeath && deaths.firstDeathPerson != null && deaths.firstDeathYear != null) {
      inPlanDeaths += 1;
      if (deaths.firstDeathPerson === 0) person0First += 1;
      if (deaths.firstDeathAge != null) firstDeathAges.push(deaths.firstDeathAge);
      h = householdWithFirstDeath(
        base,
        deaths.firstDeathPerson,
        deaths.firstDeathYear,
        survivorSpendFrac
      );
    } else {
      h = householdBothLive(base);
    }
    h.solverQuality = "fast";
    const res = simulate(h);
    if (!res.failedAnyYear) funded += 1;
    estates.push(res.afterTaxEstateReal);

    if (t % 25 === 0 || t === trials - 1) {
      opts.onProgress?.({
        phase: "longevity-mc",
        fraction: 0.05 + 0.9 * ((t + 1) / trials),
        detail: `Mortality trial ${t + 1} / ${trials}…`,
      });
    }
  }

  opts.onProgress?.({ phase: "done", fraction: 1, detail: "Stochastic longevity ready" });

  return {
    trials,
    seed,
    survivorSpendFrac,
    personNames: names,
    startYear,
    planEndYear: endYear,
    successRate: funded / trials,
    inPlanDeathRate: inPlanDeaths / trials,
    person0FirstShare: inPlanDeaths > 0 ? person0First / inPlanDeaths : 0,
    estateReal: stats(estates),
    firstDeathAge: firstDeathAges.length ? stats(firstDeathAges) : null,
    baselineEstateReal: baseline.afterTaxEstateReal,
    baselineFunded: !baseline.failedAnyYear,
    elapsedMs: performance.now() - t0,
  };
}
