/**
 * B1 — Max sustainable lifestyle spend (spend-to-zero framing).
 *
 * Default: for each candidate spendingTargetToday, re-runs analyzePlan (C grid
 * + L4 TFSA share) so the tax-aware strategy is optimal for *that* lifestyle.
 * Optional retuneStrategy:false pins C/share from a baseline for a faster path.
 */
import { simulate, type HouseholdInput, type SimulationResult } from "../simulate";
import {
  analyzePlan,
  prepareForAnalysis,
  type AnalysisOptions,
  type PlanAnalysis,
} from "./analysis";
import { resolveTfsaLevel } from "./tfsaPolicy";
import type { ProgressCallback } from "./progress";

export interface SpendToZeroResult {
  /** Suggested annual spending target in today’s dollars. */
  maxSpendToday: number;
  /** Real after-tax estate at that spend (with strategy used at that spend). */
  estateReal: number;
  funded: boolean;
  failedAnyYear: boolean;
  firstFailureYear?: number;
  /** Top-up ceiling at the winning spend. */
  ceilingUsed: number;
  /** L4 TFSA-first share at the winning spend (0 if not l4). */
  tfsaFirstShare: number;
  /** Number of spend trials evaluated (each may include a full C re-grid). */
  iterations: number;
  /** True when max funded spend still leaves estate above the target band. */
  residualEstate: boolean;
  estateEps: number;
  /** True when C (and L4 share) were re-searched at each spend trial. */
  retunedStrategy: boolean;
  summary: string;
  result: SimulationResult;
}

interface EvalAtSpend {
  res: SimulationResult;
  ceiling: number;
  share: number;
}

function isFunded(r: SimulationResult): boolean {
  return !r.failedAnyYear;
}

function evalRetune(
  prepared: HouseholdInput,
  spend: number,
  analyzeOpts: AnalysisOptions
): EvalAtSpend {
  const a: PlanAnalysis = analyzePlan(
    { ...prepared, spendingTargetToday: spend },
    analyzeOpts
  );
  return {
    res: a.primary,
    ceiling: a.bestCeilingToday,
    share: a.tfsaTune?.bestShare ?? 0,
  };
}

function evalPinned(
  prepared: HouseholdInput,
  spend: number,
  ceiling: number,
  share: number,
  level: ReturnType<typeof resolveTfsaLevel>
): EvalAtSpend {
  const res = simulate({
    ...prepared,
    spendingTargetToday: spend,
    solverQuality: "thorough",
    strategy: {
      ...(prepared.strategy ?? {}),
      topUpCeilingToday: ceiling,
      tfsaLevel: level,
      tfsaReserveYears: prepared.strategy?.tfsaReserveYears ?? 2,
      tfsaFirstShare: share,
    },
  });
  return { res, ceiling, share };
}

/**
 * Highest spendingTargetToday that is fully funded on the expected path.
 * By default re-grids C (+ L4 share) at every trial.
 */
export function findMaxSpendToZero(
  input: HouseholdInput,
  opts: {
    estateEps?: number;
    maxIters?: number;
    analyzeOpts?: AnalysisOptions;
    /** Default true — re-grid C at every spend. Set false to pin baseline C. */
    retuneStrategy?: boolean;
    /** Used only when retuneStrategy is false. */
    baseline?: PlanAnalysis;
    onProgress?: ProgressCallback;
  } = {}
): SpendToZeroResult {
  const estateEps = opts.estateEps ?? 50_000;
  const maxIters = opts.maxIters ?? 12;
  const analyzeOpts = opts.analyzeOpts ?? { quick: true };
  const retuneStrategy = opts.retuneStrategy !== false;
  const onProgress = opts.onProgress;

  const prepared = prepareForAnalysis(input);
  const level = resolveTfsaLevel(prepared.strategy?.tfsaLevel);
  prepared.strategy = {
    ...(prepared.strategy ?? {}),
    tfsaLevel: level,
    tfsaReserveYears: prepared.strategy?.tfsaReserveYears ?? 2,
  };

  let iterations = 0;
  let pinC = 0;
  let pinShare = 0;
  // Rough budget for fraction display (expand + binary + probe)
  const estTrials = maxIters + 12;
  if (!retuneStrategy) {
    onProgress?.({ phase: "baseline", fraction: 0.05, detail: "Pinning strategy from baseline…" });
    const baseline = opts.baseline ?? analyzePlan(input, analyzeOpts);
    iterations += 1;
    pinC = baseline.bestCeilingToday;
    pinShare = baseline.tfsaTune?.bestShare ?? 0;
  }

  const run = (spend: number): EvalAtSpend => {
    iterations += 1;
    onProgress?.({
      phase: "spend",
      fraction: Math.min(0.98, iterations / estTrials),
      detail: retuneStrategy
        ? `Spend trial ${iterations}: re-tuning C at $${Math.round(spend).toLocaleString("en-CA")}/yr…`
        : `Spend trial ${iterations}: $${Math.round(spend).toLocaleString("en-CA")}/yr…`,
    });
    return retuneStrategy
      ? evalRetune(prepared, spend, analyzeOpts)
      : evalPinned(prepared, spend, pinC, pinShare, level);
  };

  let lo = Math.max(1_000, Math.round(input.spendingTargetToday * 0.25));
  let hi = Math.max(input.spendingTargetToday, 40_000);
  let eHi = run(hi);
  const hardCap = Math.max(hi * 8, 500_000);
  while (isFunded(eHi.res) && hi < hardCap) {
    lo = hi;
    hi = Math.min(hardCap, Math.round(hi * 1.35));
    eHi = run(hi);
  }

  let eLo = run(lo);
  if (!isFunded(eLo.res)) {
    let failLo = 1_000;
    let failHi = lo;
    for (let i = 0; i < maxIters; i++) {
      const mid = Math.round((failLo + failHi) / 2);
      const e = run(mid);
      if (isFunded(e.res)) {
        failLo = mid;
        eLo = e;
      } else {
        failHi = mid;
      }
    }
    lo = failLo;
  }

  let bestSpend = lo;
  let best = eLo;
  if (!isFunded(best.res)) {
    return finish(bestSpend, best, iterations, estateEps, retuneStrategy, true);
  }

  let searchLo = lo;
  let searchHi = hi;
  for (let i = 0; i < maxIters; i++) {
    if (searchHi - searchLo <= 500) break;
    const mid = Math.round((searchLo + searchHi) / 2);
    const e = run(mid);
    if (isFunded(e.res)) {
      bestSpend = mid;
      best = e;
      searchLo = mid;
    } else {
      searchHi = mid;
    }
  }

  const probe = run(bestSpend + 250);
  if (isFunded(probe.res)) {
    bestSpend = bestSpend + 250;
    best = probe;
  }

  return finish(bestSpend, best, iterations, estateEps, retuneStrategy, false);
}

function finish(
  bestSpend: number,
  best: EvalAtSpend,
  iterations: number,
  estateEps: number,
  retuneStrategy: boolean,
  hardFail: boolean
): SpendToZeroResult {
  const funded = isFunded(best.res);
  const residualEstate = best.res.afterTaxEstateReal > estateEps;
  const cNote = retuneStrategy
    ? `Top-up ceiling re-optimized at this spend: $${Math.round(best.ceiling).toLocaleString("en-CA")}`
    : `Top-up ceiling pinned: $${Math.round(best.ceiling).toLocaleString("en-CA")}`;

  let summary: string;
  if (hardFail || !funded) {
    summary =
      "Could not fully fund even a reduced lifestyle on the expected path after strategy search.";
  } else if (residualEstate) {
    summary =
      `Max funded lifestyle about $${bestSpend.toLocaleString("en-CA")}/yr (today’s $) still leaves ` +
      `~$${Math.round(best.res.afterTaxEstateReal).toLocaleString("en-CA")} real estate — ` +
      `horizon ends before the pile is fully spent. ${cNote}.`;
  } else {
    summary =
      `About $${bestSpend.toLocaleString("en-CA")}/yr (today’s $) funds every year with real estate ` +
      `near zero (≤ $${estateEps.toLocaleString("en-CA")}). ${cNote}.`;
  }

  return {
    maxSpendToday: bestSpend,
    estateReal: best.res.afterTaxEstateReal,
    funded,
    failedAnyYear: best.res.failedAnyYear,
    firstFailureYear: best.res.firstFailureYear,
    ceilingUsed: best.ceiling,
    tfsaFirstShare: best.share,
    iterations,
    residualEstate,
    estateEps,
    retunedStrategy: retuneStrategy,
    summary,
    result: best.res,
  };
}
