/**
 * tax.ts — Ontario + federal personal tax engine (design doc §8).
 * Pure functions over a YearPolicy (year-scaled parameters from policy.ts);
 * defaults to the 2026 baseline, which the Gate 1 anchor suite asserts.
 *
 * Return-line correspondence (T1 / ON428), encoded in computeTax():
 *   1. total income (dividends grossed up, capital gains at inclusion rate)
 *   2. deductions: RRSP (20800) + elected split-pension transfer (21000)
 *   3. net income before adjustments (23400) → OAS recovery tax (rate over
 *      threshold, capped at OAS received) is BOTH a deduction (23500) and a
 *      payable amount (42200)
 *   4. net income (23600) drives BPA/age phase-outs
 *   5. federal: brackets − creditRate × personal credits − DTC, floor 0
 *   6. Ontario (ON428 ordering, validated by the 39.34% eligible-dividend
 *      anchor): brackets − 5.05% × personal credits → SURTAX on that amount →
 *      subtract Ontario DTC → Ontario tax reduction → add Health Premium
 *
 * Simplifications (design §17): credits at the lowest rate; spousal transfer of
 * *unused* non-refundable personal credit tax (BPA/age/pension pool model — not
 * line-by-line Schedule 2); no AMT/TOSI; no medical/charitable credits;
 * federal Top-Up Tax Credit not modelled (immaterial at this credit mix).
 */

import { type Bracket } from "./constants-2026";
import { POLICY_2026, type YearPolicy } from "./policy";

// ---------------------------------------------------------------------------
// Inputs & results
// ---------------------------------------------------------------------------

export interface PersonIncome {
  /** Age attained on Dec 31 of the tax year (age credit requires >= 65). */
  ageDec31: number;
  employment?: number;
  cpp?: number;
  /** OAS entitlement for the year, before recovery tax. */
  oas?: number;
  /** DB/RPP lifetime pension — eligible pension income at ANY age. */
  dbPension?: number;
  /** RRIF + LIF withdrawals — eligible pension income only at 65+. */
  rrifLifIncome?: number;
  /** Direct RRSP withdrawals — taxable, NOT eligible pension income. */
  rrspWithdrawal?: number;
  interest?: number;
  /** Actual (cash) eligible Canadian dividends; engine applies the gross-up. */
  eligibleDividends?: number;
  /** Realized capital gains (full amount; engine applies inclusion rate). */
  realizedCapitalGains?: number;
  /** RRSP deduction claimed this year (working years). */
  rrspDeduction?: number;
}

/** Elected pension income splitting between spouses (design §7.3). */
export interface PensionSplit {
  transferredOut?: number;
  receivedIn?: number;
  /** Share of `receivedIn` sourced from DB pension (0..1) — sets the
   * transferee's pension-credit eligibility under 65. */
  receivedDbShare?: number;
}

export interface TaxResult {
  federalTax: number;
  ontarioTax: number;          // incl. surtax, DTC, reduction, health premium
  oasClawback: number;
  totalTax: number;
  netIncomeBeforeAdjustments: number; // line 23400
  netIncome: number;                  // line 23600
  taxableIncome: number;
  /**
   * Unused federal personal-credit tax (lowest-rate × BPA/age/pension) after
   * offsetting federal tax before those credits (DTC already applied separately).
   * Available for simplified spousal transfer.
   */
  unusedFederalCreditTax: number;
  /** Unused Ontario basic personal-credit tax (before surtax/DTC/OHP). */
  unusedOntarioCreditTax: number;
  /** Ontario Health Premium component of ontarioTax (not transferable). */
  ontarioHealthPremium: number;
  breakdown: {
    grossedUpDividends: number;
    taxableCapitalGains: number;
    federalBeforeCredits: number;
    federalPersonalCredits: number;
    federalDtc: number;
    ontarioBeforeCredits: number;
    ontarioPersonalCredits: number;
    ontarioBasicTax: number;
    ontarioSurtax: number;
    ontarioDtc: number;
    ontarioTaxReduction: number;
    ontarioHealthPremium: number;
    eligiblePensionIncomeForCredit: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const n = (x: number | undefined): number => Math.max(0, x ?? 0);

/** Lightweight instrumentation for performance tests (negligible overhead). */
export const _stats = { computeTaxCalls: 0 };

/** Progressive tax on `income` over `brackets` (marginal system). */
export function bracketTax(income: number, brackets: Bracket[]): number {
  if (income <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const from = brackets[i].from;
    const to = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
    if (income <= from) break;
    tax += (Math.min(income, to) - from) * brackets[i].rate;
  }
  return tax;
}

/** Federal BPA with high-income phase-out of the enhancement (line 30000). */
export function federalBpa(netIncome: number, policy: YearPolicy = POLICY_2026): number {
  const { max, base, phaseOutStart, phaseOutEnd } = policy.federal.bpa;
  if (netIncome <= phaseOutStart) return max;
  if (netIncome >= phaseOutEnd) return base;
  const frac = (netIncome - phaseOutStart) / (phaseOutEnd - phaseOutStart);
  return max - (max - base) * frac;
}

/** Age amount (65+) with phase-out — federal or Ontario parameter set. */
function ageAmount(netIncome: number, amount: number, threshold: number, rate: number): number {
  return Math.max(0, amount - rate * Math.max(0, netIncome - threshold));
}

/** Ontario Health Premium — piecewise on TAXABLE income; bands frozen [T4032ON]. */
export function ontarioHealthPremium(taxableIncome: number, policy: YearPolicy = POLICY_2026): number {
  let premium = 0;
  for (const b of policy.ontario.healthPremiumBands) {
    if (taxableIncome > b.over) {
      premium = Math.min(b.cap, b.base + b.rate * (taxableIncome - b.over));
    }
  }
  return premium;
}

// ---------------------------------------------------------------------------
// Core per-person computation
// ---------------------------------------------------------------------------

const EMPTY_BREAKDOWN: TaxResult["breakdown"] = Object.freeze({
  grossedUpDividends: 0, taxableCapitalGains: 0, federalBeforeCredits: 0,
  federalPersonalCredits: 0, federalDtc: 0, ontarioBeforeCredits: 0,
  ontarioPersonalCredits: 0, ontarioBasicTax: 0, ontarioSurtax: 0,
  ontarioDtc: 0, ontarioTaxReduction: 0, ontarioHealthPremium: 0,
  eligiblePensionIncomeForCredit: 0,
});

const LEAN_RESULT: TaxResult = {
  federalTax: 0, ontarioTax: 0, oasClawback: 0, totalTax: 0,
  netIncomeBeforeAdjustments: 0, netIncome: 0, taxableIncome: 0,
  unusedFederalCreditTax: 0, unusedOntarioCreditTax: 0,
  ontarioHealthPremium: 0,
  breakdown: EMPTY_BREAKDOWN,
};

/** `lean` returns a SHARED MUTABLE result (no allocation) — the returned
 *  object is valid only until the next computeTax call. Callers must read
 *  the needed number(s) immediately and never retain the reference. All
 *  simulator hot-path call sites obey this; records use the default mode. */
export function computeTax(
  p: PersonIncome,
  split: PensionSplit = {},
  policy: YearPolicy = POLICY_2026,
  lean = false
): TaxResult {
  _stats.computeTaxCalls++;
  const F = policy.federal, O = policy.ontario;
  const employment = n(p.employment);
  const cpp = n(p.cpp);
  const oas = n(p.oas);
  const dbPension = n(p.dbPension);
  const rrifLif = n(p.rrifLifIncome);
  const rrspW = n(p.rrspWithdrawal);
  const interest = n(p.interest);
  const eligDiv = n(p.eligibleDividends);
  const gains = n(p.realizedCapitalGains);
  const rrspDeduction = n(p.rrspDeduction);
  const transferredOut = n(split.transferredOut);
  const receivedIn = n(split.receivedIn);
  const receivedDbShare = Math.min(1, Math.max(0, split.receivedDbShare ?? 0));

  const is65 = p.ageDec31 >= 65;

  // --- 1. Total income ------------------------------------------------------
  const grossedUpDividends = eligDiv * (1 + F.dividendGrossUp);
  const taxableCapitalGains = gains * F.capitalGainsInclusion;
  const totalIncome =
    employment + cpp + oas + dbPension + rrifLif + rrspW +
    interest + grossedUpDividends + taxableCapitalGains + receivedIn;

  // --- 2–4. Deductions, OAS recovery, net income ----------------------------
  const deductions = rrspDeduction + transferredOut;
  const netIncomeBeforeAdjustments = Math.max(0, totalIncome - deductions); // 23400
  const oasClawback = Math.min(
    oas,
    F.oasClawbackRate * Math.max(0, netIncomeBeforeAdjustments - F.oasClawbackThreshold)
  );
  const netIncome = netIncomeBeforeAdjustments - oasClawback; // 23600
  const taxableIncome = netIncome;

  // --- Eligible pension income for the pension credit -----------------------
  const ownEligibleGross = dbPension + (is65 ? rrifLif : 0);
  const transferReduction = Math.min(transferredOut, ownEligibleGross);
  const receivedEligible =
    receivedIn * receivedDbShare + (is65 ? receivedIn * (1 - receivedDbShare) : 0);
  const eligiblePensionIncomeForCredit =
    Math.max(0, ownEligibleGross - transferReduction) + receivedEligible;

  // --- 5. Federal tax --------------------------------------------------------
  const federalBeforeCredits = bracketTax(taxableIncome, F.brackets);
  const fedCreditsAmount =
    federalBpa(netIncome, policy) +
    (is65 ? ageAmount(netIncome, F.ageAmount, F.ageAmountThreshold, F.ageAmountPhaseOutRate) : 0) +
    Math.min(F.pensionIncomeAmount, eligiblePensionIncomeForCredit);
  const federalDtc = F.dividendDtc * grossedUpDividends;
  const fedPersonalCreditTax = F.creditRate * fedCreditsAmount;
  const fedTaxAfterDtc = Math.max(0, federalBeforeCredits - federalDtc);
  const federalTax = Math.max(0, fedTaxAfterDtc - fedPersonalCreditTax);
  const unusedFederalCreditTax = Math.max(0, fedPersonalCreditTax - fedTaxAfterDtc);

  // --- 6. Ontario tax (ON428 ordering) ---------------------------------------
  const ontarioBeforeCredits = bracketTax(taxableIncome, O.brackets);
  const onCreditsAmount =
    O.bpa +
    (is65 ? ageAmount(netIncome, O.ageAmount, O.ageAmountThreshold, O.ageAmountPhaseOutRate) : 0) +
    Math.min(O.pensionIncomeAmount, eligiblePensionIncomeForCredit);
  const onPersonalCreditTax = O.creditRate * onCreditsAmount;
  const ontarioBasicTax = Math.max(0, ontarioBeforeCredits - onPersonalCreditTax);
  const unusedOntarioCreditTax = Math.max(0, onPersonalCreditTax - ontarioBeforeCredits);
  const ontarioSurtax =
    O.surtaxR1 * Math.max(0, ontarioBasicTax - O.surtaxT1) +
    O.surtaxR2 * Math.max(0, ontarioBasicTax - O.surtaxT2);
  const ontarioDtc = O.dividendDtc * grossedUpDividends;
  const afterDtc = Math.max(0, ontarioBasicTax + ontarioSurtax - ontarioDtc);
  const ontarioTaxReduction = Math.min(
    afterDtc,
    Math.max(0, 2 * O.taxReductionBasic - afterDtc)
  );
  const ontarioHealthPremiumAmt = ontarioHealthPremium(taxableIncome, policy);
  const ontarioTax = afterDtc - ontarioTaxReduction + ontarioHealthPremiumAmt;

  const totalTax = federalTax + ontarioTax + oasClawback;

  if (lean) {
    LEAN_RESULT.federalTax = federalTax;
    LEAN_RESULT.ontarioTax = ontarioTax;
    LEAN_RESULT.oasClawback = oasClawback;
    LEAN_RESULT.totalTax = totalTax;
    LEAN_RESULT.netIncomeBeforeAdjustments = netIncomeBeforeAdjustments;
    LEAN_RESULT.netIncome = netIncome;
    LEAN_RESULT.taxableIncome = taxableIncome;
    LEAN_RESULT.unusedFederalCreditTax = unusedFederalCreditTax;
    LEAN_RESULT.unusedOntarioCreditTax = unusedOntarioCreditTax;
    LEAN_RESULT.ontarioHealthPremium = ontarioHealthPremiumAmt;
    return LEAN_RESULT;
  }
  return {
    federalTax, ontarioTax, oasClawback, totalTax,
    netIncomeBeforeAdjustments, netIncome, taxableIncome,
    unusedFederalCreditTax, unusedOntarioCreditTax,
    ontarioHealthPremium: ontarioHealthPremiumAmt,
    breakdown: {
      grossedUpDividends, taxableCapitalGains,
      federalBeforeCredits, federalPersonalCredits: fedCreditsAmount, federalDtc,
      ontarioBeforeCredits, ontarioPersonalCredits: onCreditsAmount,
      ontarioBasicTax, ontarioSurtax, ontarioDtc, ontarioTaxReduction,
      ontarioHealthPremium: ontarioHealthPremiumAmt,
      eligiblePensionIncomeForCredit,
    },
  };
}

/**
 * Transfer unused non-refundable personal-credit tax between spouses (simplified).
 * Models the idea of Schedule 2 transfers for age/pension/BPA-type credits as a
 * single pool — not line-by-line CRA forms. Does not transfer DTC, OHP, or OAS clawback.
 */
export function applySpousalCreditTransfers(
  a: TaxResult,
  b: TaxResult
): {
  a: TaxResult;
  b: TaxResult;
  federalTransferred: number;
  ontarioTransferred: number;
} {
  const clone = (r: TaxResult): TaxResult => ({
    ...r,
    breakdown: { ...r.breakdown },
  });
  const outA = clone(a);
  const outB = clone(b);

  // Federal: A's unused → B's federal tax; B's unused → A's federal tax
  const fedAB = Math.min(outA.unusedFederalCreditTax, outB.federalTax);
  const fedBA = Math.min(outB.unusedFederalCreditTax, outA.federalTax);
  outB.federalTax -= fedAB;
  outA.unusedFederalCreditTax -= fedAB;
  outA.federalTax -= fedBA;
  outB.unusedFederalCreditTax -= fedBA;

  // Ontario income tax portion (exclude OHP — cannot be transferred)
  const onTaxA = Math.max(0, outA.ontarioTax - outA.ontarioHealthPremium);
  const onTaxB = Math.max(0, outB.ontarioTax - outB.ontarioHealthPremium);
  const onAB = Math.min(outA.unusedOntarioCreditTax, onTaxB);
  const onBA = Math.min(outB.unusedOntarioCreditTax, onTaxA);
  outB.ontarioTax -= onAB;
  outA.unusedOntarioCreditTax -= onAB;
  outA.ontarioTax -= onBA;
  outB.unusedOntarioCreditTax -= onBA;

  outA.totalTax = outA.federalTax + outA.ontarioTax + outA.oasClawback;
  outB.totalTax = outB.federalTax + outB.ontarioTax + outB.oasClawback;

  return {
    a: outA,
    b: outB,
    federalTransferred: fedAB + fedBA,
    ontarioTransferred: onAB + onBA,
  };
}

/** Household total tax after simplified spousal credit transfer (snapshots). */
export function householdTaxAfterCreditTransfer(
  a: Pick<
    TaxResult,
    | "federalTax"
    | "ontarioTax"
    | "oasClawback"
    | "unusedFederalCreditTax"
    | "unusedOntarioCreditTax"
    | "ontarioHealthPremium"
  >,
  b: Pick<
    TaxResult,
    | "federalTax"
    | "ontarioTax"
    | "oasClawback"
    | "unusedFederalCreditTax"
    | "unusedOntarioCreditTax"
    | "ontarioHealthPremium"
  >
): number {
  const fedAB = Math.min(a.unusedFederalCreditTax, b.federalTax);
  const fedBA = Math.min(b.unusedFederalCreditTax, a.federalTax);
  const onTaxA = Math.max(0, a.ontarioTax - a.ontarioHealthPremium);
  const onTaxB = Math.max(0, b.ontarioTax - b.ontarioHealthPremium);
  const onAB = Math.min(a.unusedOntarioCreditTax, onTaxB);
  const onBA = Math.min(b.unusedOntarioCreditTax, onTaxA);
  return (
    a.federalTax -
    fedBA +
    (a.ontarioTax - onBA) +
    a.oasClawback +
    (b.federalTax - fedAB) +
    (b.ontarioTax - onAB) +
    b.oasClawback
  );
}

// ---------------------------------------------------------------------------
// Household: pension income splitting optimizer (design §7.3)
// ---------------------------------------------------------------------------

export interface HouseholdTaxResult {
  a: TaxResult;
  b: TaxResult;
  totalTax: number;
  splitAmount: number;
  splitFraction: number;
  splitDirection: "AtoB" | "BtoA" | "none";
}

/** Eligible-for-splitting pension income (ITA 60.03): DB any age, RRIF/LIF 65+. */
export function splittableIncome(p: PersonIncome): { total: number; dbShare: number } {
  const db = n(p.dbPension);
  const rrif = p.ageDec31 >= 65 ? n(p.rrifLifIncome) : 0;
  const total = db + rrif;
  return { total, dbShare: total > 0 ? db / total : 0 };
}

/**
 * Search the elected split (0–50% of the transferor's eligible pension income,
 * both directions, 1% grid then a 0.1% refinement) minimizing household tax.
 */
export function optimizeHouseholdTax(
  pa: PersonIncome,
  pb: PersonIncome,
  policy: YearPolicy = POLICY_2026
): HouseholdTaxResult {
  const evalSplit = (from: PersonIncome, to: PersonIncome, frac: number) => {
    const s = splittableIncome(from);
    const amt = s.total * frac;
    const rFrom = computeTax(from, { transferredOut: amt }, policy);
    const rTo = computeTax(to, { receivedIn: amt, receivedDbShare: s.dbShare }, policy);
    return { rFrom, rTo, amt, total: rFrom.totalTax + rTo.totalTax };
  };

  const packAB = (
    ra: TaxResult,
    rb: TaxResult,
    dir: "AtoB" | "BtoA" | "none",
    amt: number,
    frac: number
  ): HouseholdTaxResult => {
    const t = applySpousalCreditTransfers(ra, rb);
    return {
      a: t.a,
      b: t.b,
      totalTax: t.a.totalTax + t.b.totalTax,
      splitAmount: amt,
      splitFraction: frac,
      splitDirection: dir,
    };
  };

  let best: HouseholdTaxResult = (() => {
    const a = computeTax(pa, {}, policy), b = computeTax(pb, {}, policy);
    return packAB(a, b, "none", 0, 0);
  })();

  for (const dir of ["AtoB", "BtoA"] as const) {
    const [from, to] = dir === "AtoB" ? [pa, pb] : [pb, pa];
    if (splittableIncome(from).total <= 0) continue;
    let bestFrac = 0, bestTotal = Infinity;
    for (let f = 0; f <= 0.5 + 1e-9; f += 0.01) {
      const { rFrom, rTo, total: _raw } = evalSplit(from, to, f);
      const ra = dir === "AtoB" ? rFrom : rTo;
      const rb = dir === "AtoB" ? rTo : rFrom;
      const total = householdTaxAfterCreditTransfer(ra, rb);
      if (total < bestTotal - 1e-9) { bestTotal = total; bestFrac = f; }
    }
    for (let f = Math.max(0, bestFrac - 0.01); f <= Math.min(0.5, bestFrac + 0.01) + 1e-9; f += 0.001) {
      const { rFrom, rTo } = evalSplit(from, to, f);
      const ra = dir === "AtoB" ? rFrom : rTo;
      const rb = dir === "AtoB" ? rTo : rFrom;
      const total = householdTaxAfterCreditTransfer(ra, rb);
      if (total < bestTotal - 1e-9) { bestTotal = total; bestFrac = f; }
    }
    if (bestTotal < best.totalTax - 1e-9) {
      const { rFrom, rTo, amt } = evalSplit(from, to, bestFrac);
      const ra = dir === "AtoB" ? rFrom : rTo;
      const rb = dir === "AtoB" ? rTo : rFrom;
      best = packAB(ra, rb, dir, amt, bestFrac);
    }
  }
  return best;
}

/** Numerical marginal effective tax rate on an extra dollar of `field`. */
export function marginalRate(
  p: PersonIncome,
  field: keyof PersonIncome & string,
  delta = 100,
  policy: YearPolicy = POLICY_2026
): number {
  const base = computeTax(p, {}, policy).totalTax;
  const bumped = computeTax(
    { ...p, [field]: n(p[field] as number | undefined) + delta }, {}, policy
  ).totalTax;
  return (bumped - base) / delta;
}
