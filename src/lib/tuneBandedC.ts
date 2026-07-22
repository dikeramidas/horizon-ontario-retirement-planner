/**
 * Age-banded top-up ceiling search + OAS soft-cap defaults.
 *
 * 1) Flat C grid (same objective as tuneStrategy: funded years → real estate)
 * 2) Coordinate descent on three age bands around that flat C
 * 3) Optional fine polish per band
 *
 * Default band edges: older-spouse age ≤71 / ≤80 / ≤120.
 */
import { simulate, type HouseholdInput, type SimulationResult } from "../simulate";
import { tuneStrategy, type TuneResult } from "../mc";

export const DEFAULT_C_BAND_AGES = [71, 80, 120] as const;

export type CeilingBand = { untilAge: number; ceilingToday: number };

export interface BandedTuneResult extends TuneResult {
  /** Optimized age bands (today’s $). */
  bestCeilingBands: CeilingBand[];
  /** OAS soft-cap applied on the tuned path. */
  oasSoftCap: boolean;
  /** Flat C found before banding (for display). */
  flatCeilingToday: number;
}

function fundedYears(res: SimulationResult): number {
  return res.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
}

function score(res: SimulationResult): { fundedYears: number; estateReal: number } {
  return { fundedYears: fundedYears(res), estateReal: res.afterTaxEstateReal };
}

function better(
  a: { fundedYears: number; estateReal: number },
  b: { fundedYears: number; estateReal: number }
): boolean {
  return (
    a.fundedYears > b.fundedYears ||
    (a.fundedYears === b.fundedYears && a.estateReal > b.estateReal + 1e-6)
  );
}

function bandsFromFlat(flatC: number, ages: readonly number[] = DEFAULT_C_BAND_AGES): CeilingBand[] {
  return ages.map((untilAge) => ({ untilAge, ceilingToday: flatC }));
}

function uniqueSorted(xs: number[], maxC: number): number[] {
  return [...new Set(xs.map((x) => Math.max(0, Math.round(x))))]
    .filter((x) => x <= maxC + 1e-9)
    .sort((a, b) => a - b);
}

function candidatesAround(base: number, step: number, maxC: number): number[] {
  const out: number[] = [0, base];
  for (const m of [-3, -2, -1, 0, 1, 2, 3, 4]) out.push(base + m * step);
  for (const m of [0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.4]) {
    out.push(Math.round((base * m) / 1000) * 1000);
  }
  return uniqueSorted(out, maxC);
}

function evalBands(
  input: HouseholdInput,
  bands: CeilingBand[],
  oasSoftCap: boolean,
  flatC: number
): { res: SimulationResult; s: { fundedYears: number; estateReal: number } } {
  const res = simulate({
    ...input,
    solverQuality: "thorough",
    strategy: {
      ...(input.strategy ?? {}),
      topUpCeilingToday: flatC,
      ceilingBands: bands,
      oasSoftCap,
    },
  });
  return { res, s: score(res) };
}

export interface TuneBandedOpts {
  maxCeiling?: number;
  coarseStep?: number;
  fineStep?: number;
  /** Default true — product tax-aware path. */
  oasSoftCap?: boolean;
  /** Skip band descent; only flat C + soft-cap. */
  banded?: boolean;
  bandAges?: readonly number[];
  onProgress?: (p: { phase: string; fraction?: number; detail?: string }) => void;
}

/**
 * Full product strategy tune: flat C, then age-band refinement, OAS soft-cap on.
 */
export function tuneStrategyBanded(
  input: HouseholdInput,
  opts: TuneBandedOpts = {}
): BandedTuneResult {
  const maxC = opts.maxCeiling ?? 150_000;
  const coarse = opts.coarseStep ?? 10_000;
  const fine = opts.fineStep ?? 2_500;
  const oasSoftCap = opts.oasSoftCap !== false;
  const banded = opts.banded !== false;
  const bandAges = opts.bandAges ?? DEFAULT_C_BAND_AGES;
  const report = opts.onProgress;

  // Flat search without bands so the grid is 1-D
  const flatInput: HouseholdInput = {
    ...input,
    strategy: {
      ...(input.strategy ?? {}),
      ceilingBands: undefined,
      oasSoftCap,
    },
  };

  report?.({ phase: "strategy", fraction: 0.1, detail: "Searching flat top-up ceiling C…" });
  const flat = tuneStrategy(flatInput, {
    maxCeiling: maxC,
    coarseStep: coarse,
    fineStep: fine,
  });

  let bands = bandsFromFlat(flat.bestCeilingToday, bandAges);
  let bestRes = flat.tuned;
  // Re-sim with soft-cap + flat bands for a fair baseline when banded is off
  {
    const e = evalBands(input, bands, oasSoftCap, flat.bestCeilingToday);
    bestRes = e.res;
  }
  let bestScore = score(bestRes);

  if (banded) {
    report?.({
      phase: "strategy-bands",
      fraction: 0.45,
      detail: "Refining age-banded ceilings…",
    });
    // Coordinate descent: optimize each band while holding others
    for (let bi = 0; bi < bands.length; bi++) {
      const cands = candidatesAround(flat.bestCeilingToday, coarse, maxC);
      let localBestC = bands[bi].ceilingToday;
      for (const c of cands) {
        const trial = bands.map((b, i) =>
          i === bi ? { ...b, ceilingToday: c } : b
        );
        const e = evalBands(input, trial, oasSoftCap, flat.bestCeilingToday);
        if (better(e.s, bestScore)) {
          bestScore = e.s;
          bestRes = e.res;
          localBestC = c;
          bands = trial;
        }
      }
      bands = bands.map((b, i) =>
        i === bi ? { ...b, ceilingToday: localBestC } : b
      );
      report?.({
        phase: "strategy-bands",
        fraction: 0.45 + ((bi + 1) / bands.length) * 0.35,
        detail: `Band ≤${bands[bi].untilAge}: C≈$${Math.round(localBestC).toLocaleString("en-CA")}`,
      });
    }

    // Fine polish ±coarse around each band with fine step
    for (let bi = 0; bi < bands.length; bi++) {
      const base = bands[bi].ceilingToday;
      const fineCands = uniqueSorted(
        [
          base,
          ...Array.from({ length: 9 }, (_, k) => base + (k - 4) * fine),
        ],
        maxC
      );
      let localBestC = base;
      for (const c of fineCands) {
        const trial = bands.map((b, i) =>
          i === bi ? { ...b, ceilingToday: c } : b
        );
        const e = evalBands(input, trial, oasSoftCap, flat.bestCeilingToday);
        if (better(e.s, bestScore)) {
          bestScore = e.s;
          bestRes = e.res;
          localBestC = c;
          bands = trial;
        }
      }
      bands = bands.map((b, i) =>
        i === bi ? { ...b, ceilingToday: localBestC } : b
      );
    }
  }

  // Naive: C=0, no bands
  const naive =
    flat.bestCeilingToday === 0 && !banded
      ? flat.naive
      : simulate({
          ...input,
          solverQuality: "thorough",
          strategy: {
            ...(input.strategy ?? {}),
            topUpCeilingToday: 0,
            ceilingBands: undefined,
            oasSoftCap,
          },
        });

  const estateTaxOf = (r: SimulationResult) => r.finalBalances.total - r.afterTaxEstate;
  // Representative single C for UI fields: early-retirement band (first)
  const repC = bands[0]?.ceilingToday ?? flat.bestCeilingToday;

  report?.({ phase: "strategy", fraction: 0.85, detail: "Banded ceiling locked in" });

  return {
    bestCeilingToday: repC,
    bestCeilingBands: bands,
    oasSoftCap,
    flatCeilingToday: flat.bestCeilingToday,
    tuned: bestRes,
    naive,
    grid: flat.grid,
    totalTaxSaving:
      naive.lifetimeTax +
      estateTaxOf(naive) -
      (bestRes.lifetimeTax + estateTaxOf(bestRes)),
    estateRealGain: bestRes.afterTaxEstateReal - naive.afterTaxEstateReal,
  };
}
