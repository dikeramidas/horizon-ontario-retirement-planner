/**
 * L4: multi-year TFSA-first share search on the deterministic path.
 * Objective: lexicographic (funded years, then real after-tax estate).
 */
import { simulate, type HouseholdInput, type SimulationResult } from "../simulate";
import { L4_SHARE_GRID } from "./tfsaPolicy";

export interface TfsaTunePoint {
  share: number;
  fundedYears: number;
  estateReal: number;
  lifetimeTax: number;
}

export interface TfsaTuneResult {
  bestShare: number;
  best: SimulationResult;
  /** L3-equivalent path (share = 0) for comparison. */
  l3Baseline: SimulationResult;
  grid: TfsaTunePoint[];
}

function score(res: SimulationResult): { fundedYears: number; estateReal: number } {
  const fundedYears = res.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
  return { fundedYears, estateReal: res.afterTaxEstateReal };
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

/**
 * Grid-search TFSA-first share with L4 policy (includes L1–L3 rules).
 * Expects strategy.tfsaLevel = "l4" and a fixed topUpCeilingToday.
 */
export function tuneTfsaShare(input: HouseholdInput): TfsaTuneResult {
  const base: HouseholdInput = {
    ...input,
    solverQuality: "thorough",
    strategy: {
      ...(input.strategy ?? {}),
      tfsaLevel: "l4",
      tfsaReserveYears: input.strategy?.tfsaReserveYears ?? 2,
    },
  };

  const evalShare = (share: number) => {
    const res = simulate({
      ...base,
      strategy: { ...(base.strategy ?? {}), tfsaFirstShare: share },
    });
    const s = score(res);
    return {
      res,
      point: {
        share,
        fundedYears: s.fundedYears,
        estateReal: s.estateReal,
        lifetimeTax: res.lifetimeTax,
      },
    };
  };

  const grid: TfsaTunePoint[] = [];
  let best = evalShare(0);
  grid.push(best.point);
  const l3Baseline = best.res;

  for (const share of L4_SHARE_GRID) {
    if (share === 0) continue;
    const e = evalShare(share);
    grid.push(e.point);
    if (better(e.point, best.point)) best = e;
  }
  grid.sort((a, b) => a.share - b.share);

  return {
    bestShare: best.point.share,
    best: best.res,
    l3Baseline,
    grid,
  };
}
