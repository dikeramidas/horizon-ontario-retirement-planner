/**
 * Primary plan analysis used by the Horizon UI.
 * Runs the strategy tuner (lexicographic funded years → estate) which also
 * produces the naive C=0 baseline for side-by-side comparison.
 */
import { type TuneResult } from "../mc";
import type { HouseholdInput } from "../simulate";
import { validateHousehold } from "./validate";
import { tuneTfsaShare, type TfsaTuneResult } from "./tfsaTune";
import { resolveTfsaLevel } from "./tfsaPolicy";
import { estateTaxOf } from "./estateTax";
import type { ProgressCallback } from "./progress";
import {
  tuneStrategyBanded,
  type BandedTuneResult,
  type CeilingBand,
} from "./tuneBandedC";
import { splitCeilingByRegistered } from "./personPolicy";
import { simulate } from "../simulate";

export interface AnalysisOptions {
  /** Coarser grid for snappy first paint; thorough enough for review demos. */
  quick?: boolean;
  /** Optional progress for long UI runs (not cloned into workers as a function — worker sets this). */
  onProgress?: ProgressCallback;
  /** Search age-banded C (default true). */
  bandedCeiling?: boolean;
  /** Soft-cap C at OAS threshold (default true). */
  oasSoftCap?: boolean;
}

export interface PlanAnalysis {
  tune: TuneResult & {
    bestCeilingBands?: CeilingBand[];
    oasSoftCap?: boolean;
    flatCeilingToday?: number;
  };
  /** Deterministic tuned path (same as tune.tuned). */
  primary: TuneResult["tuned"];
  naive: TuneResult["naive"];
  bestCeilingToday: number;
  bestCeilingBands?: CeilingBand[];
  oasSoftCap: boolean;
  flatCeilingToday?: number;
  /** Person-level ceilings (today’s $) used on the primary path. */
  personCeilingsToday?: [number, number];
  totalTaxSaving: number;
  estateRealGain: number;
  funded: boolean;
  /** L4 TFSA share search (undefined if strategy is not l4). */
  tfsaTune?: TfsaTuneResult;
}

/** Drop DB when current entitlement is $0 so hidden accrual cannot rebuild a pension. */
function stripPhantomDb(persons: HouseholdInput["persons"]): void {
  for (const p of persons) {
    if (p.db && (p.db.currentAnnualEntitlementToday ?? 0) <= 0) {
      p.db = undefined;
    }
  }
}

export function prepareForAnalysis(input: HouseholdInput): HouseholdInput {
  const prepared = {
    ...structuredClone(input),
    solverQuality: "thorough" as const,
  };
  // UI only exposes current DB entitlement. A $0 entitlement with leftover
  // accrualPerYearToday (e.g. from the sample plan) would silently rebuild a pension.
  stripPhantomDb(prepared.persons);
  return prepared;
}

/**
 * Full strategy analysis: searches top-up ceiling C on the deterministic path
 * and returns tuned vs naive (C=0) results via the public `tuneStrategy` entry.
 */
export function analyzePlan(input: HouseholdInput, opts: AnalysisOptions = {}): PlanAnalysis {
  const v = validateHousehold(input);
  if (!v.ok) {
    throw new Error(v.errors.map((e) => e.message).join(" "));
  }
  const report = opts.onProgress;
  report?.({ phase: "prepare", fraction: 0.05, detail: "Preparing household…" });

  const prepared = prepareForAnalysis(input);
  // Ensure TFSA policy defaults to l4 for product analysis
  const level = resolveTfsaLevel(prepared.strategy?.tfsaLevel);
  prepared.strategy = {
    ...(prepared.strategy ?? {}),
    tfsaLevel: level,
    tfsaReserveYears: prepared.strategy?.tfsaReserveYears ?? 2,
  };

  const banded = opts.bandedCeiling !== false;
  const oasSoftCap = opts.oasSoftCap !== false;

  report?.({
    phase: "strategy",
    fraction: 0.12,
    detail: banded
      ? "Searching flat C, then age-banded ceilings (OAS soft-cap)…"
      : "Searching top-up ceiling C…",
  });

  const tune: BandedTuneResult = tuneStrategyBanded(prepared, {
    ...(opts.quick
      ? { maxCeiling: 120_000, coarseStep: 15_000, fineStep: 5_000 }
      : { maxCeiling: 150_000, coarseStep: 10_000, fineStep: 2_500 }),
    banded,
    oasSoftCap,
    onProgress: report,
  });

  // Person-level policy: split flat C by registered balances; higher-Reg top-up priority
  report?.({ phase: "person-policy", fraction: 0.82, detail: "Person ceilings + TFSA-aware meltdown…" });
  const reg0 =
    (prepared.persons[0].balances?.rrsp ?? 0) +
    (prepared.persons[0].balances?.lira ?? 0) +
    (prepared.persons[0].balances?.dcPension ?? 0);
  const reg1 =
    (prepared.persons[1].balances?.rrsp ?? 0) +
    (prepared.persons[1].balances?.lira ?? 0) +
    (prepared.persons[1].balances?.dcPension ?? 0);
  const personCeilings = splitCeilingByRegistered(tune.flatCeilingToday, reg0, reg1);

  // After C/bands chosen, L4 searches TFSA-first share on the deterministic path
  let primary = tune.tuned;
  let tfsaTune: TfsaTuneResult | undefined;
  const withC: HouseholdInput = {
    ...prepared,
    strategy: {
      ...(prepared.strategy ?? {}),
      topUpCeilingToday: tune.bestCeilingToday,
      ceilingBands: tune.bestCeilingBands,
      oasSoftCap: tune.oasSoftCap,
      personCeilingsToday: prepared.strategy?.personCeilingsToday ?? personCeilings,
      topUpPriority: prepared.strategy?.topUpPriority ?? "higherReg",
      tfsaAwareMeltdown: prepared.strategy?.tfsaAwareMeltdown !== false,
      tfsaLevel: level,
    },
  };
  // Re-sim with person policy (banded path may not have included person ceilings)
  primary = simulate({
    ...withC,
    solverQuality: "thorough",
  });
  if (level === "l4") {
    report?.({ phase: "tfsa", fraction: 0.88, detail: "Tuning TFSA-first share…" });
    tfsaTune = tuneTfsaShare(withC);
    primary = tfsaTune.best;
  }

  report?.({ phase: "finalize", fraction: 0.95, detail: "Comparing to naive baseline…" });
  const totalTaxSaving =
    (tune.naive.lifetimeTax + estateTaxOf(tune.naive)) -
    (primary.lifetimeTax + estateTaxOf(primary));

  report?.({ phase: "done", fraction: 1, detail: "Plan ready" });
  return {
    tune: {
      ...tune,
      tuned: primary,
      totalTaxSaving,
      estateRealGain: primary.afterTaxEstateReal - tune.naive.afterTaxEstateReal,
      bestCeilingBands: tune.bestCeilingBands,
      oasSoftCap: tune.oasSoftCap,
      flatCeilingToday: tune.flatCeilingToday,
    },
    primary,
    naive: tune.naive,
    bestCeilingToday: tune.bestCeilingToday,
    bestCeilingBands: tune.bestCeilingBands,
    oasSoftCap: tune.oasSoftCap,
    flatCeilingToday: tune.flatCeilingToday,
    personCeilingsToday: withC.strategy?.personCeilingsToday,
    totalTaxSaving,
    estateRealGain: primary.afterTaxEstateReal - tune.naive.afterTaxEstateReal,
    funded: !primary.failedAnyYear,
    tfsaTune,
  };
}

export interface McStrategyPins {
  topUpCeilingToday: number;
  tfsaFirstShare?: number;
  tfsaLevel?: ReturnType<typeof resolveTfsaLevel>;
  tfsaReserveYears?: number;
  ceilingBands?: CeilingBand[];
  oasSoftCap?: boolean;
}

/** Household used for Monte Carlo — pins ceiling + L4 TFSA share (and level/reserve). */
export function householdForMonteCarlo(
  input: HouseholdInput,
  pins: number | McStrategyPins
): HouseholdInput {
  const p: McStrategyPins = typeof pins === "number" ? { topUpCeilingToday: pins } : pins;
  const base = structuredClone(input);
  stripPhantomDb(base.persons);
  return {
    ...base,
    solverQuality: "fast",
    strategy: {
      ...(base.strategy ?? {}),
      topUpCeilingToday: p.topUpCeilingToday,
      ceilingBands: p.ceilingBands ?? base.strategy?.ceilingBands,
      oasSoftCap: p.oasSoftCap ?? base.strategy?.oasSoftCap,
      tfsaLevel: p.tfsaLevel ?? resolveTfsaLevel(base.strategy?.tfsaLevel),
      tfsaReserveYears: p.tfsaReserveYears ?? base.strategy?.tfsaReserveYears ?? 2,
      tfsaFirstShare:
        p.tfsaFirstShare ?? base.strategy?.tfsaFirstShare ?? 0,
    },
  };
}

/**
 * UI Monte Carlo prep: if analysis is missing or stale, re-run analyzePlan and
 * pin top-up ceiling + L4 TFSA share so MC matches the deterministic policy.
 */
export function prepareMonteCarloRun(
  input: HouseholdInput,
  state: {
    hasTune: boolean;
    stale: boolean;
    displayedCeiling?: number;
    displayedTfsaShare?: number;
  },
  opts: AnalysisOptions = { quick: true }
): {
  household: HouseholdInput;
  analysis: PlanAnalysis | null;
  ceiling: number;
  tfsaFirstShare: number;
} {
  if (!state.hasTune || state.stale) {
    const analysis = analyzePlan(input, opts);
    const share = analysis.tfsaTune?.bestShare ?? input.strategy?.tfsaFirstShare ?? 0;
    return {
      analysis,
      ceiling: analysis.bestCeilingToday,
      tfsaFirstShare: share,
      household: householdForMonteCarlo(input, {
        topUpCeilingToday: analysis.bestCeilingToday,
        ceilingBands: analysis.bestCeilingBands,
        oasSoftCap: analysis.oasSoftCap,
        tfsaFirstShare: share,
        tfsaLevel: resolveTfsaLevel(input.strategy?.tfsaLevel),
        tfsaReserveYears: input.strategy?.tfsaReserveYears ?? 2,
      }),
    };
  }
  const ceiling = state.displayedCeiling ?? input.strategy?.topUpCeilingToday ?? 0;
  const share =
    state.displayedTfsaShare ?? input.strategy?.tfsaFirstShare ?? 0;
  return {
    analysis: null,
    ceiling,
    tfsaFirstShare: share,
    household: householdForMonteCarlo(input, {
      topUpCeilingToday: ceiling,
      ceilingBands: input.strategy?.ceilingBands,
      oasSoftCap: input.strategy?.oasSoftCap,
      tfsaFirstShare: share,
      tfsaLevel: resolveTfsaLevel(input.strategy?.tfsaLevel),
      tfsaReserveYears: input.strategy?.tfsaReserveYears ?? 2,
    }),
  };
}
