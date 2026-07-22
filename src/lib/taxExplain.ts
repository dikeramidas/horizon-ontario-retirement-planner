/**
 * Tax-strategy explanation + future statutory bracket placement.
 * Projects from TuneResult / SimulationResult — does not re-solve tax law.
 */
import type { Bracket } from "../constants-2026";
import { buildYearPolicy } from "../policy";
import type { SimulationResult, YearRow } from "../simulate";
import type { TuneResult } from "../mc";

export interface BracketPlacement {
  /** Marginal statutory rate of the band containing taxable income. */
  rate: number;
  /** Lower bound of that band (inclusive). */
  from: number;
  /** Upper bound (exclusive), or null for top band. */
  to: number | null;
  /** Short label e.g. "20.5%" or "14% band". */
  label: string;
}

export interface PersonYearBracketEstimate {
  personIndex: 0 | 1;
  name: string;
  ageDec31: number;
  /** Engine taxable income (pre-split field stored on the year row). */
  taxableIncome: number;
  taxTotal: number;
  oasClawback: number;
  federal: BracketPlacement;
  ontario: BracketPlacement;
  /** Year-scaled OAS clawback threshold (for context). */
  oasThreshold: number;
  inOasZone: boolean;
}

export interface YearBracketEstimate {
  year: number;
  cpiIndex: number;
  solverActive: boolean;
  persons: [PersonYearBracketEstimate, PersonYearBracketEstimate];
}

/** Place income in a progressive bracket table (rate applies above `from`). */
export function placeInBrackets(income: number, brackets: Bracket[]): BracketPlacement {
  if (!brackets.length) {
    return { rate: 0, from: 0, to: null, label: "n/a" };
  }
  const ti = Math.max(0, income);
  let idx = 0;
  for (let i = 0; i < brackets.length; i++) {
    if (ti >= brackets[i].from - 1e-9) idx = i;
  }
  const b = brackets[idx];
  const to = idx + 1 < brackets.length ? brackets[idx + 1].from : null;
  const pct = (b.rate * 100).toFixed(b.rate * 100 % 1 === 0 ? 0 : 1);
  return {
    rate: b.rate,
    from: b.from,
    to,
    label: `${pct}% band`,
  };
}

function personBracket(
  row: YearRow,
  personIndex: 0 | 1,
  name: string
): PersonYearBracketEstimate {
  const py = row.persons[personIndex];
  const policy = buildYearPolicy(row.cpiIndex);
  const taxableIncome = py.taxableIncomePreSplit;
  const federal = placeInBrackets(taxableIncome, policy.federal.brackets);
  const ontario = placeInBrackets(taxableIncome, policy.ontario.brackets);
  const oasThreshold = policy.federal.oasClawbackThreshold;
  return {
    personIndex,
    name,
    ageDec31: py.ageDec31,
    taxableIncome,
    taxTotal: py.tax.total,
    oasClawback: py.tax.clawback,
    federal,
    ontario,
    oasThreshold,
    inOasZone: py.tax.clawback > 0.5 || taxableIncome > oasThreshold,
  };
}

/**
 * Future tax-bracket estimates along a simulated path.
 * Uses each row's CPI index → year-scaled federal/Ontario brackets.
 */
export function buildBracketEstimates(
  result: SimulationResult,
  personNames: [string, string] = ["Spouse A", "Spouse B"],
  opts: { retirementOnly?: boolean } = {}
): YearBracketEstimate[] {
  const retirementOnly = opts.retirementOnly ?? true;
  const out: YearBracketEstimate[] = [];
  for (const row of result.rows) {
    if (retirementOnly && !row.solverActive) continue;
    out.push({
      year: row.year,
      cpiIndex: row.cpiIndex,
      solverActive: row.solverActive,
      persons: [
        personBracket(row, 0, personNames[0]),
        personBracket(row, 1, personNames[1]),
      ],
    });
  }
  return out;
}

export interface StrategyWhyMetrics {
  bestCeilingToday: number;
  tunedLifetimeTax: number;
  naiveLifetimeTax: number;
  /** Living-years tax only (naive − tuned); may be negative if meltdown front-loads. */
  livingTaxDelta: number;
  totalTaxSaving: number; // includes estate tax effect from tuneStrategy
  estateRealGain: number;
  tunedEstateReal: number;
  naiveEstateReal: number;
  /** Retirement years with deliberate top-up > $1. */
  yearsWithTopUp: number;
  /** Retirement years either spouse pays OAS clawback (tuned path). */
  yearsWithOasClawbackTuned: number;
  yearsWithOasClawbackNaive: number;
  /** Peak person-year taxable income on tuned vs naive (retirement). */
  peakTaxableTuned: number;
  peakTaxableNaive: number;
  /** Share of person-years in federal top two rates (29%+). */
  shareHighFedBracketTuned: number;
  shareHighFedBracketNaive: number;
  /** Plain-language bullets grounded in the metrics (not marketing fluff). */
  reasons: string[];
  disclaimer: string;
}

function peakTaxable(result: SimulationResult): number {
  let m = 0;
  for (const row of result.rows) {
    if (!row.solverActive) continue;
    for (const p of row.persons) m = Math.max(m, p.taxableIncomePreSplit);
  }
  return m;
}

function countTopUpYears(result: SimulationResult): number {
  let n = 0;
  for (const row of result.rows) {
    if (!row.solverActive) continue;
    if (row.persons[0].withdrawals.topUp + row.persons[1].withdrawals.topUp > 1) n++;
  }
  return n;
}

function countOasYears(result: SimulationResult): number {
  let n = 0;
  for (const row of result.rows) {
    if (!row.solverActive) continue;
    if (row.persons[0].tax.clawback + row.persons[1].tax.clawback > 0.5) n++;
  }
  return n;
}

function shareHighFed(result: SimulationResult): number {
  let hi = 0, tot = 0;
  for (const row of result.rows) {
    if (!row.solverActive) continue;
    const policy = buildYearPolicy(row.cpiIndex);
    for (const p of row.persons) {
      tot++;
      const place = placeInBrackets(p.taxableIncomePreSplit, policy.federal.brackets);
      if (place.rate >= 0.29 - 1e-9) hi++;
    }
  }
  return tot > 0 ? hi / tot : 0;
}

function moneyPlain(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

/**
 * Why the tuned top-up ceiling is preferred vs naive C=0 for this household.
 * Relative heuristic explanation — not a claim of global multi-year optimality.
 */
export function buildStrategyWhy(tune: TuneResult): StrategyWhyMetrics {
  const livingTaxDelta = tune.naive.lifetimeTax - tune.tuned.lifetimeTax;
  const yearsWithTopUp = countTopUpYears(tune.tuned);
  const yearsWithOasClawbackTuned = countOasYears(tune.tuned);
  const yearsWithOasClawbackNaive = countOasYears(tune.naive);
  const peakTaxableTuned = peakTaxable(tune.tuned);
  const peakTaxableNaive = peakTaxable(tune.naive);
  const shareHighFedBracketTuned = shareHighFed(tune.tuned);
  const shareHighFedBracketNaive = shareHighFed(tune.naive);

  const reasons: string[] = [];
  reasons.push(
    `The search picked a top-up ceiling of ${moneyPlain(tune.bestCeilingToday)} (today's dollars): after spending is funded, extra RRSP/RRIF withdrawals fill up to that taxable-income level so registered accounts are drawn earlier, not only at forced RRIF minimums.`
  );

  if (tune.totalTaxSaving > 500) {
    reasons.push(
      `Including terminal estate tax, the tuned path saves about ${moneyPlain(tune.totalTaxSaving)} vs never topping up (naive). Meltdown often pays more tax in living years to shrink the final RRIF tax bomb — total tax (living + estate) is the fair comparison.`
    );
  } else if (tune.totalTaxSaving < -500) {
    reasons.push(
      `On this path, total tax (living + estate) is similar or slightly higher with the ceiling; the search still preferred it for funded years and/or a larger real estate (${moneyPlain(tune.estateRealGain)} estate gain).`
    );
  } else {
    reasons.push(
      `Lifetime tax is nearly the same either way; the ceiling was chosen mainly to improve funded years and/or real estate (${moneyPlain(tune.estateRealGain)} estate difference).`
    );
  }

  if (tune.estateRealGain > 1000) {
    reasons.push(
      `Real after-tax estate is about ${moneyPlain(tune.estateRealGain)} higher under the tuned path — converting registered wealth into TFSA/non-registered (or lower terminal balances) is a major part of the tax story.`
    );
  }

  if (yearsWithTopUp > 0) {
    reasons.push(
      `Deliberate top-ups run in ${yearsWithTopUp} retirement year(s), smoothing taxable income instead of letting large RRIF minimums and a final deemed disposition pile into high brackets later.`
    );
  } else if (tune.bestCeilingToday > 0) {
    reasons.push(
      `The chosen ceiling is above current incomes in many years, so forced RRIF/LIF draws and spending already fill the lower bands without extra top-ups every year.`
    );
  }

  if (yearsWithOasClawbackNaive > yearsWithOasClawbackTuned + 1) {
    reasons.push(
      `OAS recovery tax shows up in fewer years on the tuned path (${yearsWithOasClawbackTuned} vs ${yearsWithOasClawbackNaive} naive) — income was less often pushed over the clawback threshold.`
    );
  } else if (yearsWithOasClawbackTuned > 0) {
    reasons.push(
      `OAS clawback still applies in ${yearsWithOasClawbackTuned} year(s) on the tuned path — the ceiling is a tradeoff against the 15% recovery zone, not a guarantee of staying under it.`
    );
  }

  if (peakTaxableNaive > peakTaxableTuned * 1.05 + 5000) {
    reasons.push(
      `Peak person-year taxable income falls from about ${moneyPlain(peakTaxableNaive)} (naive) to ${moneyPlain(peakTaxableTuned)} (tuned), keeping more years out of higher statutory federal bands.`
    );
  } else if (shareHighFedBracketNaive > shareHighFedBracketTuned + 0.05) {
    reasons.push(
      `Share of person-years in federal 29%+ bands is lower under the tuned path (${(shareHighFedBracketTuned * 100).toFixed(0)}% vs ${(shareHighFedBracketNaive * 100).toFixed(0)}% naive).`
    );
  }

  reasons.push(
    `Ontario surtax and frozen high brackets still matter over decades: the table below maps each year of taxable income onto year-scaled federal and Ontario bands (CPI-indexed thresholds where the law indexes them).`
  );

  return {
    bestCeilingToday: tune.bestCeilingToday,
    tunedLifetimeTax: tune.tuned.lifetimeTax,
    naiveLifetimeTax: tune.naive.lifetimeTax,
    livingTaxDelta,
    totalTaxSaving: tune.totalTaxSaving,
    estateRealGain: tune.estateRealGain,
    tunedEstateReal: tune.tuned.afterTaxEstateReal,
    naiveEstateReal: tune.naive.afterTaxEstateReal,
    yearsWithTopUp,
    yearsWithOasClawbackTuned,
    yearsWithOasClawbackNaive,
    peakTaxableTuned,
    peakTaxableNaive,
    shareHighFedBracketTuned,
    shareHighFedBracketNaive,
    reasons,
    disclaimer:
      "This is the engine's RRSP/RRIF top-up ceiling search vs a no-top-up baseline — a strong planning heuristic, not a proof of the globally optimal multi-decade tax schedule.",
  };
}
