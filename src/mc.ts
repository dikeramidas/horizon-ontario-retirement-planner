/**
 * mc.ts — Seeded Monte Carlo runner + strategy tuner (design §7.4, §9, G3).
 *
 * Return model (§9.1): each account's gross return is lognormal with the
 * user's input return as the ARITHMETIC mean:
 *     gross = exp( ln(1+µ) − σ²/2 + σ·z ),   E[gross] = 1+µ
 * Shocks share a single market factor M per year across both spouses and all
 * accounts:  z = √ρ·M + √(1−ρ)·ε  →  pairwise correlation exactly ρ.
 * At σ = 0 the generator emits µ EXACTLY (no exp/ln round-trip), so a
 * zero-volatility trial is bit-identical to the deterministic simulator.
 *
 * Inflation (§9.2): fixed (default), or AR(1)
 *     π_t = target + φ(π_{t−1} − target) + σ·ε,  clamped to [min, max].
 *
 * Volatility defaults are modelling choices (UI-editable), not pinned policy:
 * defaultVol = 11%/yr for any account without an explicit σ.
 */

import {
  simulate,
  type HouseholdInput, type SimulationResult, type AccountReturns, type SimPath, type YearRow,
} from "./simulate";
import { ECON_DEFAULTS } from "./constants-2026";

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

/** mulberry32 — fast 32-bit PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** splitmix32-style hash to derive independent per-trial streams. */
export function deriveSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Box–Muller standard normal with cached spare. */
export function gaussianFactory(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0;
    do { u = rng(); } while (u <= 1e-12);
    const v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type PersonVols = AccountReturns; // same shape; values are annual σ

export interface MonteCarloConfig {
  trials?: number;                      // default ECON_DEFAULTS.mcTrials (2,000)
  seed?: number;                        // default 1
  marketCorrelation?: number;           // pairwise ρ, default 0.85
  vols?: [PersonVols | undefined, PersonVols | undefined];
  defaultVol?: number;                  // σ for accounts without an explicit vol; default 0.11
  inflation?:
    | { kind: "fixed" }
    | { kind: "ar1"; target?: number; phi?: number; sigma?: number; min?: number; max?: number };
  /** Optional progress (e.g. every ~5% of trials). Not structured-cloneable — main/worker only. */
  onProgress?: (p: { phase: string; fraction?: number; detail?: string }) => void;
}

const ACCOUNTS = ["rrsp", "lira", "dcPension", "tfsa", "unregistered"] as const;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function yearsOf(input: HouseholdInput): number {
  const startYear = input.startYear ?? 2026;
  if (input.yearsOverride) return input.yearsOverride;
  const youngerBirth = Math.max(input.persons[0].birthYear, input.persons[1].birthYear);
  return youngerBirth + (input.horizonAgeYoungerSpouse ?? 95) - startYear + 1;
}

// ---------------------------------------------------------------------------
// Trial path generation
// ---------------------------------------------------------------------------

export function generateTrialPath(input: HouseholdInput, cfg: MonteCarloConfig, trial: number): SimPath {
  const years = yearsOf(input);
  const rng = mulberry32(deriveSeed(cfg.seed ?? 1, trial));
  const gauss = gaussianFactory(rng);
  const rho = clamp(cfg.marketCorrelation ?? ECON_DEFAULTS.marketCorrelation, 0, 1);
  const loadM = Math.sqrt(rho), loadI = Math.sqrt(1 - rho);
  const defaultVol = cfg.defaultVol ?? 0.11;

  // Inflation path (index 0 corresponds to the start year and is unused).
  let inflationByYear: number[] | undefined;
  const im = cfg.inflation ?? { kind: "fixed" as const };
  if (im.kind === "ar1") {
    const d = ECON_DEFAULTS.inflationAR1;
    const target = im.target ?? d.target, phi = im.phi ?? d.phi, sigma = im.sigma ?? d.sigma;
    const lo = im.min ?? d.min, hi = im.max ?? d.max;
    inflationByYear = new Array<number>(years);
    inflationByYear[0] = input.inflation ?? target;
    let prev = target;
    for (let y = 1; y < years; y++) {
      const pi = sigma > 0 ? clamp(target + phi * (prev - target) + sigma * gauss(), lo, hi) : target;
      inflationByYear[y] = pi;
      prev = pi;
    }
  }

  const returnsByYear: Array<[AccountReturns, AccountReturns]> = new Array(years);
  for (let y = 0; y < years; y++) {
    const M = gauss(); // shared market factor for the year
    const pair: [AccountReturns, AccountReturns] = [{}, {}];
    for (let i = 0; i < 2; i++) {
      const fixed = input.persons[i].returns ?? {};
      const vols = cfg.vols?.[i];
      for (const a of ACCOUNTS) {
        const mu = fixed[a] ?? 0;
        const sigma = vols?.[a] ?? defaultVol;
        pair[i][a] = sigma > 0
          ? Math.exp(Math.log(1 + mu) - (sigma * sigma) / 2 + sigma * (loadM * M + loadI * gauss())) - 1
          : mu; // exact passthrough — zero-vol trials are bit-identical to deterministic
      }
    }
    returnsByYear[y] = pair;
  }
  return { inflationByYear, returnsByYear };
}

// ---------------------------------------------------------------------------
// Monte Carlo runner
// ---------------------------------------------------------------------------

export interface MonteCarloResult {
  trials: number;
  seed: number;
  startYear: number;
  years: number;
  successRate: number;
  failures: Array<{ year: number; count: number }>;
  /** Real (deflated) household net worth per year across trials. */
  netWorthRealPercentiles: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };
  estateReal: { p10: number; p50: number; p90: number; mean: number };
  lifetimeTax: { p50: number; mean: number };
  elapsedMs: number;
}

function rowNetWorth(row: YearRow): number {
  const a = row.persons[0].balancesEnd, b = row.persons[1].balancesEnd;
  return a.rrsp + a.lira + a.dcPension + a.lif + a.tfsa + a.unregistered +
         b.rrsp + b.lira + b.dcPension + b.lif + b.tfsa + b.unregistered;
}

function percentileSorted(sorted: number[] | Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = q * (n - 1);
  const i = Math.floor(pos), frac = pos - i;
  return i + 1 < n ? sorted[i] * (1 - frac) + sorted[i + 1] * frac : sorted[i];
}

export function runMonteCarlo(input: HouseholdInput, cfg: MonteCarloConfig = {}): MonteCarloResult {
  const t0 = (globalThis.performance ?? { now: () => Date.now() }).now();
  const trials = cfg.trials ?? ECON_DEFAULTS.mcTrials;
  const seed = cfg.seed ?? 1;
  const startYear = input.startYear ?? 2026;
  const years = yearsOf(input);
  const mcInput: HouseholdInput = { ...input, solverQuality: input.solverQuality ?? "fast" };

  const grid = new Float64Array(trials * years);
  const estates = new Float64Array(trials);
  const taxes = new Float64Array(trials);
  let successes = 0;
  const failCounts = new Map<number, number>();

  const progressEvery = Math.max(1, Math.floor(trials / 20));
  for (let trial = 0; trial < trials; trial++) {
    const path = generateTrialPath(input, cfg, trial);
    const res = simulate({ ...mcInput, path });
    if (res.failedAnyYear) {
      failCounts.set(res.firstFailureYear!, (failCounts.get(res.firstFailureYear!) ?? 0) + 1);
    } else successes++;
    estates[trial] = res.afterTaxEstateReal;
    taxes[trial] = res.lifetimeTax;
    const base = trial * years;
    for (let y = 0; y < years; y++) {
      grid[base + y] = rowNetWorth(res.rows[y]) / res.rows[y].cpiIndex;
    }
    if (
      cfg.onProgress &&
      (trial === 0 || trial === trials - 1 || (trial + 1) % progressEvery === 0)
    ) {
      cfg.onProgress({
        phase: "montecarlo",
        fraction: (trial + 1) / trials,
        detail: `Market path ${trial + 1} of ${trials}`,
      });
    }
  }

  const col = new Float64Array(trials);
  const p10: number[] = [], p25: number[] = [], p50: number[] = [], p75: number[] = [], p90: number[] = [];
  for (let y = 0; y < years; y++) {
    for (let t = 0; t < trials; t++) col[t] = grid[t * years + y];
    col.sort();
    p10.push(percentileSorted(col, 0.10));
    p25.push(percentileSorted(col, 0.25));
    p50.push(percentileSorted(col, 0.50));
    p75.push(percentileSorted(col, 0.75));
    p90.push(percentileSorted(col, 0.90));
  }
  estates.sort(); taxes.sort();
  const mean = (xs: Float64Array) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);

  return {
    trials, seed, startYear, years,
    successRate: trials > 0 ? successes / trials : 1,
    failures: [...failCounts.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count })),
    netWorthRealPercentiles: { p10, p25, p50, p75, p90 },
    estateReal: {
      p10: percentileSorted(estates, 0.10),
      p50: percentileSorted(estates, 0.50),
      p90: percentileSorted(estates, 0.90),
      mean: mean(estates),
    },
    lifetimeTax: { p50: percentileSorted(taxes, 0.50), mean: mean(taxes) },
    elapsedMs: (globalThis.performance ?? { now: () => Date.now() }).now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Strategy tuner (design §7.4): choose the RRSP/RRIF top-up ceiling C on the
// DETERMINISTIC path; lexicographic objective (funded years, then estate).
// ---------------------------------------------------------------------------

export interface TunePoint { ceiling: number; fundedYears: number; estateReal: number }

export interface TuneResult {
  bestCeilingToday: number;
  tuned: SimulationResult;   // deterministic, thorough solver, best C
  naive: SimulationResult;   // C = 0 baseline (unregistered → registered → TFSA)
  grid: TunePoint[];
  /** (lifetime + estate) tax, naive − tuned, nominal. Estate tax must be
   *  included: the meltdown strategy pays tax EARLIER to shrink the terminal
   *  registered balance, so living-years tax alone would mislead. */
  totalTaxSaving: number;
  estateRealGain: number; // tuned − naive, real dollars (the decision metric)
}

export function tuneStrategy(input: HouseholdInput, opts: { maxCeiling?: number; coarseStep?: number; fineStep?: number } = {}): TuneResult {
  const maxC = opts.maxCeiling ?? 150_000;
  const coarse = opts.coarseStep ?? 10_000;
  const fine = opts.fineStep ?? 2_500;

  const evalC = (C: number) => {
    const res = simulate({
      ...input,
      solverQuality: "thorough",
      strategy: { ...(input.strategy ?? {}), topUpCeilingToday: C },
    });
    const fundedYears = res.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
    return { res, point: { ceiling: C, fundedYears, estateReal: res.afterTaxEstateReal } };
  };
  const better = (a: TunePoint, b: TunePoint) =>
    a.fundedYears > b.fundedYears ||
    (a.fundedYears === b.fundedYears && a.estateReal > b.estateReal + 1e-6);

  const grid: TunePoint[] = [];
  let best = evalC(0);
  grid.push(best.point);
  for (let C = coarse; C <= maxC + 1e-9; C += coarse) {
    const e = evalC(C);
    grid.push(e.point);
    if (better(e.point, best.point)) best = e;
  }
  const lo = Math.max(0, best.point.ceiling - coarse);
  const hi = Math.min(maxC, best.point.ceiling + coarse);
  for (let C = lo; C <= hi + 1e-9; C += fine) {
    if (grid.some((g) => Math.abs(g.ceiling - C) < 1)) continue;
    const e = evalC(C);
    grid.push(e.point);
    if (better(e.point, best.point)) best = e;
  }
  grid.sort((a, b) => a.ceiling - b.ceiling);

  const naive = best.point.ceiling === 0 ? best.res : evalC(0).res;
  const estateTaxOf = (r: SimulationResult) => r.finalBalances.total - r.afterTaxEstate;
  return {
    bestCeilingToday: best.point.ceiling,
    tuned: best.res,
    naive,
    grid,
    totalTaxSaving: (naive.lifetimeTax + estateTaxOf(naive)) - (best.res.lifetimeTax + estateTaxOf(best.res)),
    estateRealGain: best.res.afterTaxEstateReal - naive.afterTaxEstateReal,
  };
}
