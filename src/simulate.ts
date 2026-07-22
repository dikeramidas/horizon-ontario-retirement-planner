/**
 * simulate.ts — Deterministic lifetime household simulator (design §5–§7),
 * now path-capable: per-year inflation and per-account returns can be
 * supplied (Monte Carlo), falling back to the fixed deterministic inputs.
 *
 * Conventions (design §5, hand-checkable):
 *  - Annual steps; age in year t = t − birthYear (age attained Dec 31).
 *    RRIF minimums use age at Jan 1; the Ontario LIF maximum uses age
 *    ATTAINED (FSRA PE0196INF keying).
 *  - Salary is earned in years where ageDec31 < retirementAge.
 *  - Growth: B1 = B0·(1+r) + netFlow·(1+r/2)  (mid-year convention).
 *  - Unregistered distributions are computed on the OPENING balance, are
 *    reinvested (part of the total return; they raise ACB), and are taxable
 *    whether or not spent. Sale gains use opening (B0, ACB0).
 *  - The spending solver runs from the first year either spouse is retired.
 *
 * Solver (design §7.3, restructured for Monte Carlo performance):
 *  the pension-split fraction is optimized ONCE per year at the base point
 *  (full 0.1%-precision search, both directions), the withdrawal W is then
 *  bisected with the split held fixed, the split is locally refined at the
 *  solved W, and W is re-bracketed narrowly only if the split moved. This
 *  converges to the same fixed point as optimizing the split inside every
 *  bisection candidate, at ~15× fewer tax evaluations.
 */

import {
  applySpousalCreditTransfers,
  computeTax,
  householdTaxAfterCreditTransfer,
  type PersonIncome,
  type TaxResult,
} from "./tax";
import { estimateGis } from "./lib/gis";
import { ontarioEstateAdminTax } from "./lib/estateAdminTax";
import { buildYearPolicy, type YearPolicy } from "./policy";
import {
  allocateDiscretionaryW,
  resolveTfsaLevel,
  tfsaReserveDollars,
  type TfsaLevel,
} from "./lib/tfsaPolicy";
import { nominalSpendTarget } from "./lib/spendPlan";
import { housingValueNominal, includeHousingInEstate, shouldSellHousing } from "./lib/housing";
import {
  assignPersonTopUps,
  parkSurplusTfsaFirst,
  personOrder,
  scaleTopUpsToTfsaRoom,
} from "./lib/personPolicy";

/** YearPolicy cache keyed by cpi — fixed-inflation Monte Carlo trials share
 *  every year's policy; stochastic-inflation paths miss and build normally. */
const policyCache = new Map<number, YearPolicy>();
function policyFor(cpi: number): YearPolicy {
  let p = policyCache.get(cpi);
  if (!p) {
    if (policyCache.size > 4096) policyCache.clear();
    p = buildYearPolicy(cpi);
    policyCache.set(cpi, p);
  }
  return p;
}
import { rrifMinFactor, ontarioLifMaxFactor } from "./constants-2026";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type SavingsSpec =
  | { type: "fixed"; amount: number }
  | { type: "pctOfSalary"; pct: number }
  | { type: "none" };

export interface UnregisteredDistribution {
  interestFrac: number;
  eligibleDividendFrac: number;
  realizedGainFrac: number;
}

export interface AccountReturns {
  rrsp?: number; lira?: number; dcPension?: number; tfsa?: number; unregistered?: number;
}

/** Per-year overrides for stochastic runs (index 0 = start year). */
export interface SimPath {
  inflationByYear?: number[];
  returnsByYear?: Array<[AccountReturns, AccountReturns]>;
}

export interface PersonInput {
  name: string;
  birthYear: number;
  retirementAge: number;
  salaryToday?: number;
  salaryRealGrowth?: number;
  savings?: { rrsp?: SavingsSpec; tfsa?: SavingsSpec; unregistered?: SavingsSpec; dc?: SavingsSpec };
  reinvestRrspRefund?: boolean;
  rrspRoomNow?: number;
  tfsaRoomNow?: number;
  cpp?: { annualAt65Today: number; startAge: number };
  oas?: { startAge: number; residenceYears: number };
  db?: {
    currentAnnualEntitlementToday: number;
    accrualPerYearToday?: number;
    startAge?: number;
    indexedToCpi?: boolean;
  };
  balances?: {
    rrsp?: number; lira?: number; dcPension?: number; tfsa?: number;
    unregistered?: { balance: number; acb: number };
  };
  returns?: AccountReturns;
  unregisteredDistribution?: UnregisteredDistribution;
  lifUnlock50?: boolean;
  rrifUseYoungerSpouseAge?: boolean;
}

export interface SpendPhase {
  /** Younger spouse age when this phase begins (inclusive). */
  fromAgeYounger: number;
  /** Annual lifestyle spend in today’s $ for this phase. */
  spendToday: number;
}

export interface OneTimeGoal {
  year: number;
  amountToday: number;
  label?: string;
}

export interface HousingSpec {
  enabled: boolean;
  /** Market value in today’s $. */
  valueToday: number;
  /** Real annual growth above inflation (default 0.01). */
  realGrowth?: number;
  /** Optional calendar year to sell and deposit proceeds to unregistered. */
  sellYear?: number;
  /** Include remaining home in terminal estate (principal-residence, no tax). Default true. */
  includeInEstate?: boolean;
}

export interface PortfolioSleeves {
  /** Equity weight 0..1 (rest bonds). Blends into account expected returns. */
  equityWeight: number;
  equityReturn?: number;
  bondReturn?: number;
}

export interface HouseholdInput {
  startYear?: number;
  inflation?: number;
  spendingTargetToday: number;
  /** B8: optional age-phased lifestyle (overrides base spend by younger age). */
  spendPhases?: SpendPhase[];
  /** B8: one-time extra cash needs in named years (today’s $). */
  oneTimeGoals?: OneTimeGoal[];
  horizonAgeYoungerSpouse?: number;
  yearsOverride?: number;
  strategy?: {
    topUpCeilingToday?: number;
    /**
     * C3: optional age bands for top-up ceiling (by older spouse age).
     * First band with untilAge >= age applies; falls back to topUpCeilingToday.
     * Full-plan analysis auto-searches these when enabled (default product path).
     */
    ceilingBands?: Array<{ untilAge: number; ceilingToday: number }>;
    /**
     * Soft-cap meltdown / TFSA income ceiling at the year-scaled OAS clawback
     * threshold (avoids deliberately topping into the recovery zone).
     * Product default: true when unset after analysis.
     */
    oasSoftCap?: boolean;
    /**
     * TFSA vs taxable withdrawal policy:
     * legacy = TFSA last; l1 = taxable to C then TFSA; l2 = +OAS cap;
     * l3 = +TFSA reserve; l4 = +TFSA-first share (multi-year tuned).
     * Default l4.
     */
    tfsaLevel?: TfsaLevel;
    /** L3/L4: years of current spending to keep in TFSA when possible (default 2). */
    tfsaReserveYears?: number;
    /** L4: share of discretionary W taken from TFSA first (0..1). */
    tfsaFirstShare?: number;
    /**
     * Person-level top-up ceilings (today’s $). When set, each spouse melts
     * toward their own C (still OAS soft-capped in year $).
     */
    personCeilingsToday?: [number, number];
    /**
     * Who fills under their ceiling first for top-ups.
     * higherReg (default) = spouse with more registered balances first.
     */
    topUpPriority?: "equal" | "prefer0" | "prefer1" | "higherReg";
    /**
     * Scale RRSP top-ups so estimated after-tax surplus fits remaining TFSA room
     * (aggressive TFSA parking of meltdown). Default true in product analysis.
     */
    tfsaAwareMeltdown?: boolean;
  };
  /** "thorough" (default): full split-search cadence with base-point local
   *  refinement — used for deterministic runs and the strategy tuner.
   *  "fast": seed the split from last year and refine only at the solved
   *  withdrawal — used for Monte Carlo trials (~0.15% lifetime-tax noise). */
  solverQuality?: "thorough" | "fast";
  /**
   * B2 (scoped): first death mid-plan. Dies at *end* of firstDeathYear;
   * remaining spouse continues with optional spend step-down and asset rollover.
   */
  survivorship?: {
    enabled: boolean;
    /** Who dies first. */
    firstDeathPerson: 0 | 1;
    /** Calendar year of death (end of year). */
    firstDeathYear: number;
    /** Household spending × this after death (default 0.70). */
    survivorSpendFrac?: number;
  };
  /** B5: primary residence (optional). */
  housing?: HousingSpec;
  /** B6: rough GIS estimate when income is low (optional). */
  gis?: { enabled: boolean };
  /** C2: approximate employee CPP/EI on salary (optional). */
  payroll?: { enabled: boolean };
  /** C5: simple equity/bond sleeve mix for expected returns. */
  portfolio?: PortfolioSleeves;
  persons: [PersonInput, PersonInput];
  path?: SimPath;
}

// ---------------------------------------------------------------------------
// Per-year records
// ---------------------------------------------------------------------------

export interface PersonYear {
  ageDec31: number;
  working: boolean;
  salary: number;
  cpp: number; oasGross: number; oasClawback: number; db: number;
  /** B6: rough Guaranteed Income Supplement (tax-free). */
  gis: number;
  /** C2: approximate employee CPP + EI premiums. */
  payrollDeduction: number;
  rrifMin: number; lifMin: number; lifMax: number;
  withdrawals: { unregistered: number; registered: number; lif: number; tfsa: number; topUp: number };
  realizedGains: number; interest: number; dividends: number; distributionGains: number;
  contributions: { rrsp: number; dc: number; tfsa: number; unregistered: number };
  rrspDeduction: number; refundReceived: number;
  taxableIncomePreSplit: number;
  tax: { federal: number; ontario: number; clawback: number; total: number };
  balancesEnd: { rrsp: number; lira: number; dcPension: number; lif: number; tfsa: number; unregistered: number; acb: number };
  roomsEnd: { rrsp: number; tfsa: number };
}

export interface YearRow {
  year: number;
  cpiIndex: number;
  solverActive: boolean;
  spendingTarget: number;
  spendingAchieved: number;
  failed: boolean;
  shortfall: number;
  surplusToTfsa: number;
  surplusToUnregistered: number;
  splitDirection: "AtoB" | "BtoA" | "none";
  splitAmount: number;
  householdTax: number;
  conservationResidual: number;
  persons: [PersonYear, PersonYear];
}

export interface SimulationResult {
  rows: YearRow[];
  failedAnyYear: boolean;
  firstFailureYear?: number;
  lifetimeTax: number;
  finalBalances: { total: number; byPerson: Array<PersonYear["balancesEnd"]> };
  afterTaxEstate: number;
  afterTaxEstateReal: number;
  /** Set when survivorship.firstDeathYear falls within the plan. */
  firstDeathYear?: number;
  /** Person index who died first (if modeled). */
  firstDeathPerson?: 0 | 1;
  /** B5: terminal home value included in estate (today’s $ real if deflated by final CPI). */
  housingEstateNominal?: number;
  housingEstateReal?: number;
  /**
   * Ontario Estate Administration Tax sketch on after-tax financial estate
   * (upper-bound style; not subtracted from afterTaxEstate).
   */
  estateAdminTax?: number;
  estateAdminTaxReal?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface PState {
  in: PersonInput;
  /** False after modeled first death. */
  alive: boolean;
  /** Extra annual CPP (nominal today dollars base) for survivor benefit approx. */
  cppSurvivorBoostToday: number;
  rrsp: number;
  rrifConvertedYear?: number;
  lira: number;
  dc: number;
  lif: number;
  lifOpenedYear?: number;
  tfsa: number;
  unreg: number; acb: number;
  rrspRoom: number; tfsaRoom: number;
  prevEarnedIncome: number;
  prevPa: number;
  prevTfsaWithdrawals: number;
  pendingRefund: number;
  prevLifGrowth: number;
  dbEntitlementToday: number;
  dbNominalAtStart?: number;
}

const spec$ = (s: SavingsSpec | undefined, salary: number, cpi: number): number => {
  if (!s || s.type === "none") return 0;
  if (s.type === "fixed") return s.amount * cpi;
  return s.pct * salary;
};

const r = (x?: number) => x ?? 0;


// ---------------------------------------------------------------------------
// Solver machinery — module-level so V8 optimizes it once and it stays hot
// across all years and Monte Carlo trials (per-year closures never reach
// optimization thresholds; this was the dominant cost before hoisting).
// ---------------------------------------------------------------------------

interface YearCtx {
  policy: YearPolicy;
  py: PersonYear[];
  caps: Array<{ unreg: number; reg: number; lif: number; tfsa: number }>;
  gainFrac: [number, number];
  rrifMode: [boolean, boolean];
  baseTaxable: [number, number];
  /** Nominal income ceiling (CPI-scaled C) for TFSA policy L1+. */
  incomeCeiling: number;
  tfsaLevel: TfsaLevel;
  tfsaReserveTotal: number;
  tfsaFirstShare: number;
}

function buildIncomeFor(ctx: YearCtx, i: number, wUnreg: number, wReg: number, wLif: number, topUp: number): PersonIncome {
  const p = ctx.py[i];
  const regTotal = p.rrifMin + wReg + topUp;
  return {
    ageDec31: p.ageDec31,
    employment: p.salary,
    cpp: p.cpp,
    oas: p.oasGross,
    dbPension: p.db,
    rrifLifIncome: (ctx.rrifMode[i] ? regTotal : 0) + p.lifMin + wLif,
    rrspWithdrawal: ctx.rrifMode[i] ? 0 : regTotal,
    interest: p.interest,
    eligibleDividends: p.dividends,
    realizedCapitalGains: p.distributionGains + wUnreg * ctx.gainFrac[i],
    rrspDeduction: p.rrspDeduction,
  };
}

/** Closed-form two-person allocation minimizing max taxable income (O(1)),
 *  straight-line (no closures — this runs in the innermost solver loop). */
function allocateEq(amount: number, cap0: number, cap1: number, d0: number, d1: number, t0: number, t1: number): [number, number, number] {
  let out0 = 0, out1 = 0;
  let left = Math.max(0, amount);
  if (d0 <= 1e-12 && d1 <= 1e-12) {
    const tot = cap0 + cap1;
    if (tot > 0) {
      let take = Math.min(left * (cap0 / tot), cap0, left); out0 += take; left -= take;
      take = Math.min(left, cap1); out1 += take; left -= take;
      take = Math.min(left, cap0 - out0); out0 += take; left -= take;
    }
  } else if (d0 <= 1e-12) {
    let take = Math.min(left, cap0); out0 += take; left -= take;
    take = Math.min(left, cap1); out1 += take; left -= take;
  } else if (d1 <= 1e-12) {
    let take = Math.min(left, cap1); out1 += take; left -= take;
    take = Math.min(left, cap0); out0 += take; left -= take;
  } else {
    // 1) bring the lower-taxable spouse up to parity
    if (t0 <= t1) { const take = Math.min((t1 - t0) / d0, cap0, left); out0 += take; left -= take; }
    else { const take = Math.min((t0 - t1) / d1, cap1, left); out1 += take; left -= take; }
    // 2) split the remainder keeping taxable increments equal; spill on caps
    for (let guard = 0; guard < 4 && left > 1e-9; guard++) {
      const can0 = out0 < cap0 - 1e-9, can1 = out1 < cap1 - 1e-9;
      if (can0 && can1) {
        const l = left, share0 = d1 / (d0 + d1);
        let take = Math.min(l * share0, cap0 - out0, left); out0 += take; left -= take;
        take = Math.min(l * (1 - share0), cap1 - out1, left); out1 += take; left -= take;
      } else if (can0) { const take = Math.min(left, cap0 - out0); out0 += take; left -= take; }
      else if (can1) { const take = Math.min(left, cap1 - out1); out1 += take; left -= take; }
      else break;
    }
  }
  return [out0, out1, left];
}

function splittableOf(inc: PersonIncome): { total: number; dbShare: number } {
  const db = r(inc.dbPension);
  const rrif = (inc.ageDec31 ?? 0) >= 65 ? r(inc.rrifLifIncome) : 0;
  const total = db + rrif;
  return { total, dbShare: total > 0 ? db / total : 0 };
}

type SplitDir = "AtoB" | "BtoA" | "none";

const SCRATCH_OUT = { transferredOut: 0 };
const SCRATCH_IN = { receivedIn: 0, receivedDbShare: 0 };
function snapTax(r: TaxResult) {
  return {
    federalTax: r.federalTax,
    ontarioTax: r.ontarioTax,
    oasClawback: r.oasClawback,
    unusedFederalCreditTax: r.unusedFederalCreditTax,
    unusedOntarioCreditTax: r.unusedOntarioCreditTax,
    ontarioHealthPremium: r.ontarioHealthPremium,
  };
}

function taxPairAt(policy: YearPolicy, inc0: PersonIncome, inc1: PersonIncome, f: number, dir: SplitDir): number {
  if (dir === "none" || f <= 0) {
    const a = snapTax(computeTax(inc0, EMPTY_SPLIT, policy, true));
    const b = snapTax(computeTax(inc1, EMPTY_SPLIT, policy, true));
    return householdTaxAfterCreditTransfer(a, b);
  }
  const from = dir === "AtoB" ? inc0 : inc1;
  const to = dir === "AtoB" ? inc1 : inc0;
  const s = splittableOf(from);
  SCRATCH_OUT.transferredOut = s.total * f;
  SCRATCH_IN.receivedIn = s.total * f;
  SCRATCH_IN.receivedDbShare = s.dbShare;
  const rFrom = snapTax(computeTax(from, SCRATCH_OUT, policy, true));
  const rTo = snapTax(computeTax(to, SCRATCH_IN, policy, true));
  // Map back to person order (0, 1) for transfer helper
  const a = dir === "AtoB" ? rFrom : rTo;
  const b = dir === "AtoB" ? rTo : rFrom;
  return householdTaxAfterCreditTransfer(a, b);
}
const EMPTY_SPLIT = Object.freeze({});

/** Full household tax at the chosen split: raw per-person + after spousal credit transfer. */
function finalizePair(
  policy: YearPolicy,
  inc0: PersonIncome,
  inc1: PersonIncome,
  f: number,
  dir: SplitDir
): {
  a: TaxResult;
  b: TaxResult;
  aRaw: TaxResult;
  bRaw: TaxResult;
  splitAmount: number;
} {
  let aRaw: TaxResult;
  let bRaw: TaxResult;
  let splitAmount = 0;
  if (dir === "none" || f <= 0) {
    aRaw = computeTax(inc0, EMPTY_SPLIT, policy);
    bRaw = computeTax(inc1, EMPTY_SPLIT, policy);
  } else {
    const from = dir === "AtoB" ? inc0 : inc1;
    const to = dir === "AtoB" ? inc1 : inc0;
    const s = splittableOf(from);
    const amt = s.total * f;
    splitAmount = amt;
    const rFrom = computeTax(from, { transferredOut: amt }, policy);
    const rTo = computeTax(to, { receivedIn: amt, receivedDbShare: s.dbShare }, policy);
    aRaw = dir === "AtoB" ? rFrom : rTo;
    bRaw = dir === "AtoB" ? rTo : rFrom;
  }
  const t = applySpousalCreditTransfers(aRaw, bRaw);
  return { a: t.a, b: t.b, aRaw, bRaw, splitAmount };
}


interface SplitChoice { f: number; dir: SplitDir; total: number }

function searchSplitFull(policy: YearPolicy, inc0: PersonIncome, inc1: PersonIncome): SplitChoice {
  let bestF = 0, bestDir: SplitDir = "none", bestTotal = taxPairAt(policy, inc0, inc1, 0, "none");
  for (let d = 0; d < 2; d++) {
    const dir: SplitDir = d === 0 ? "AtoB" : "BtoA";
    if (splittableOf(dir === "AtoB" ? inc0 : inc1).total <= 0) continue;
    let cBest = 0, cTotal = Infinity;
    for (let f = 0; f <= 0.5 + 1e-9; f += 0.025) {
      const t = taxPairAt(policy, inc0, inc1, f, dir);
      if (t < cTotal - 1e-9) { cTotal = t; cBest = f; }
    }
    for (let s = 0; s < 2; s++) {
      const step = s === 0 ? 0.005 : 0.001;
      const w = step * 5;
      const lo = Math.max(0, cBest - w), hi = Math.min(0.5, cBest + w);
      for (let f = lo; f <= hi + 1e-9; f += step) {
        const t = taxPairAt(policy, inc0, inc1, f, dir);
        if (t < cTotal - 1e-9) { cTotal = t; cBest = f; }
      }
    }
    if (cTotal < bestTotal - 1e-9) { bestTotal = cTotal; bestF = cBest; bestDir = dir; }
  }
  return { f: bestF, dir: bestDir, total: bestTotal };
}

function searchSplitLocal(policy: YearPolicy, inc0: PersonIncome, inc1: PersonIncome, f0: number, dir: SplitDir, window: number, step: number): SplitChoice {
  let bestF = 0, bestDir: SplitDir = "none", bestTotal = taxPairAt(policy, inc0, inc1, 0, "none");
  if (dir !== "none") {
    // f0 itself first: when f0 < window the grid below snaps to step-multiples
    // and misses f0, and a "refinement" worse than the fraction the withdrawal
    // was solved with would push after-tax cash back below the target
    // (found by fuzzing — gaps of $3–$112 on six of 250 random lifetimes).
    const t0 = taxPairAt(policy, inc0, inc1, f0, dir);
    if (t0 < bestTotal - 1e-9) { bestTotal = t0; bestF = f0; bestDir = dir; }
    const lo = Math.max(0, f0 - window), hi = Math.min(0.5, f0 + window);
    for (let f = lo; f <= hi + 1e-9; f += step) {
      const t = taxPairAt(policy, inc0, inc1, f, dir);
      if (t < bestTotal - 1e-9) { bestTotal = t; bestF = f; bestDir = dir; }
    }
  }
  return { f: bestF, dir: bestDir, total: bestTotal };
}

interface EvalResult {
  inc: [PersonIncome, PersonIncome];
  totalTax: number;
  tU: [number, number]; tR: [number, number]; tL: [number, number]; tT: [number, number];
  afterTaxCash: number;
}

function evaluateW(ctx: YearCtx, W: number, f: number, dir: SplitDir, topUp0: number, topUp1: number, fixedCashIn: number, plannedContrib: number): EvalResult {
  const alloc = allocateDiscretionaryW(W, {
    level: ctx.tfsaLevel,
    incomeCeiling: ctx.incomeCeiling,
    oasThreshold: ctx.policy.federal.oasClawbackThreshold,
    baseTaxable: ctx.baseTaxable,
    caps: ctx.caps,
    gainFrac: ctx.gainFrac,
    tfsaReserveTotal: ctx.tfsaReserveTotal,
    tfsaFirstShare: ctx.tfsaFirstShare,
  });
  const [u0, u1] = alloc.tU;
  const [r0, r1] = alloc.tR;
  const [l0, l1] = alloc.tL;
  const [t0, t1] = alloc.tT;

  const inc0 = buildIncomeFor(ctx, 0, u0, r0, l0, topUp0);
  const inc1 = buildIncomeFor(ctx, 1, u1, r1, l1, topUp1);
  const totalTax = taxPairAt(ctx.policy, inc0, inc1, f, dir);
  const withdrawals = u0 + u1 + r0 + r1 + l0 + l1 + t0 + t1 + topUp0 + topUp1;
  const afterTaxCash = fixedCashIn + withdrawals - totalTax - plannedContrib;
  return { inc: [inc0, inc1], totalTax, tU: [u0, u1], tR: [r0, r1], tL: [l0, l1], tT: [t0, t1], afterTaxCash };
}

/** Root of afterTaxCash(W) = target via Illinois false position; expands a
 *  non-straddling warm bracket to [0, WmaxBound] as needed. */
function solveWRoot(ctx: YearCtx, lo0: number, hi0: number, WmaxBound: number, f: number, dir: SplitDir, target: number, fixedCashIn: number, plannedContrib: number): number {
  let lo = lo0, hi = hi0;
  let fLo = evaluateW(ctx, lo, f, dir, 0, 0, fixedCashIn, plannedContrib).afterTaxCash - target;
  if (fLo >= 0) {
    if (lo <= 0) return lo;
    hi = lo; lo = 0;
    fLo = evaluateW(ctx, 0, f, dir, 0, 0, fixedCashIn, plannedContrib).afterTaxCash - target;
    if (fLo >= 0) return 0;
  }
  let fHi = evaluateW(ctx, hi, f, dir, 0, 0, fixedCashIn, plannedContrib).afterTaxCash - target;
  if (fHi < 0) {
    if (hi >= WmaxBound) return hi;
    lo = hi; fLo = fHi; hi = WmaxBound;
    fHi = evaluateW(ctx, hi, f, dir, 0, 0, fixedCashIn, plannedContrib).afterTaxCash - target;
    if (fHi < 0) return hi;
  }
  let side = 0;
  for (let iter = 0; iter < 60 && hi - lo > 0.25; iter++) {
    const mid = fHi === fLo ? (lo + hi) / 2 : hi - fHi * (hi - lo) / (fHi - fLo);
    const m = Math.min(hi - 1e-9, Math.max(lo + 1e-9, mid));
    const fM = evaluateW(ctx, m, f, dir, 0, 0, fixedCashIn, plannedContrib).afterTaxCash - target;
    if (fM < 0) { lo = m; fLo = fM; if (side === -1) fHi /= 2; side = -1; }
    else { hi = m; fHi = fM; if (side === 1) fLo /= 2; side = 1; }
  }
  return hi;
}


type Opening = { rrsp: number; lif: number; tfsa: number; unreg: number; acb: number };

/** Most that can be withdrawn mid-year without the account ending negative:
 *  B1 = B0(1+r) + flow(1+r/2) ≥ 0 with flow = −w  ⇒  w ≤ B0(1+r)/(1+r/2).
 *  Binding only when r < 0 (lognormal gross keeps r > −1, so 1+r/2 > 0.5). */
function fundable(opening: number, r: number): number {
  return r < 0 ? opening * ((1 + r) / (1 + r / 2)) : opening;
}

function resolveReturns(fixed: AccountReturns | undefined, over: AccountReturns | undefined): Required<AccountReturns> {
  const f = fixed ?? {};
  return {
    rrsp: over?.rrsp ?? r(f.rrsp),
    lira: over?.lira ?? r(f.lira),
    dcPension: over?.dcPension ?? r(f.dcPension),
    tfsa: over?.tfsa ?? r(f.tfsa),
    unregistered: over?.unregistered ?? r(f.unregistered),
  };
}

/** Design §6 steps C+D for one person: income streams, contributions with
 *  overflow, refund landing, forced minimums, LIF cap, distributions.
 *  Module-level so it stays JIT-optimized across years and trials. */
function emptyPersonYear(age: number): PersonYear {
  return {
    ageDec31: age,
    working: false,
    salary: 0,
    cpp: 0, oasGross: 0, oasClawback: 0, db: 0,
    gis: 0,
    payrollDeduction: 0,
    rrifMin: 0, lifMin: 0, lifMax: 0,
    withdrawals: { unregistered: 0, registered: 0, lif: 0, tfsa: 0, topUp: 0 },
    realizedGains: 0, interest: 0, dividends: 0, distributionGains: 0,
    contributions: { rrsp: 0, dc: 0, tfsa: 0, unregistered: 0 },
    rrspDeduction: 0, refundReceived: 0,
    taxableIncomePreSplit: 0,
    tax: { federal: 0, ontario: 0, clawback: 0, total: 0 },
    balancesEnd: { rrsp: 0, lira: 0, dcPension: 0, lif: 0, tfsa: 0, unregistered: 0, acb: 0 },
    roomsEnd: { rrsp: 0, tfsa: 0 },
  };
}

/** C3: ceiling today $ for this year from bands (by older spouse age) or flat C. */
export function ceilingTodayForAges(
  strategy: HouseholdInput["strategy"],
  age0: number,
  age1: number
): number {
  const flat = strategy?.topUpCeilingToday ?? 0;
  const bands = strategy?.ceilingBands;
  if (!bands?.length) return flat;
  const age = Math.max(age0, age1);
  const sorted = [...bands].sort((a, b) => a.untilAge - b.untilAge);
  for (const b of sorted) {
    if (age <= b.untilAge) return b.ceilingToday;
  }
  return sorted[sorted.length - 1]?.ceilingToday ?? flat;
}

/**
 * Nominal (year-$) meltdown ceiling after CPI scale and optional OAS soft-cap.
 */
export function effectiveYearCeiling(
  strategy: HouseholdInput["strategy"],
  age0: number,
  age1: number,
  cpi: number,
  oasClawbackThresholdYear: number
): number {
  let c = ceilingTodayForAges(strategy, age0, age1) * cpi;
  if (strategy?.oasSoftCap && oasClawbackThresholdYear > 0) {
    c = Math.min(c, oasClawbackThresholdYear);
  }
  return Math.max(0, c);
}

/** C5: blend equity/bond into account returns when portfolio sleeves set. */
function applyPortfolioSleeves(
  base: AccountReturns | undefined,
  portfolio: HouseholdInput["portfolio"]
): AccountReturns | undefined {
  if (!portfolio || portfolio.equityWeight == null) return base;
  const w = Math.min(1, Math.max(0, portfolio.equityWeight));
  const eq = portfolio.equityReturn ?? 0.07;
  const bd = portfolio.bondReturn ?? 0.03;
  const blend = w * eq + (1 - w) * bd;
  const cons = w * 0.85 * eq + (1 - w * 0.85) * bd; // slightly more bonds for locked
  // Portfolio blend wins over per-account µ when sleeves are enabled
  return {
    ...(base ?? {}),
    rrsp: blend,
    dcPension: blend,
    tfsa: blend,
    unregistered: blend,
    lira: cons,
  };
}

/** C2: rough employee CPP + EI on salary (2026-ish rates, simplified). */
function approxPayroll(salary: number, ympe: number): number {
  if (salary <= 0) return 0;
  const cppRate = 0.0595;
  const eiRate = 0.0166;
  const eiMax = 65_700;
  const cpp = Math.min(salary, ympe) * cppRate;
  const ei = Math.min(salary, eiMax) * eiRate;
  return cpp + ei;
}



function streamsAndMins(
  s: PState, spouse: PState, year: number, yIdx: number, cpi: number,
  policy: YearPolicy, opening: Opening, rr: Required<AccountReturns>
): PersonYear {
  const age = year - s.in.birthYear;
  if (!s.alive) {
    const dead = emptyPersonYear(age);
    dead.balancesEnd = {
      rrsp: s.rrsp, lira: s.lira, dcPension: s.dc, lif: s.lif,
      tfsa: s.tfsa, unregistered: s.unreg, acb: s.acb,
    };
    dead.roomsEnd = { rrsp: s.rrspRoom, tfsa: s.tfsaRoom };
    return dead;
  }

  const unregReturn = rr.unregistered;
  const working = age < s.in.retirementAge;
  const salary = working
    ? r(s.in.salaryToday) * cpi * Math.pow(1 + r(s.in.salaryRealGrowth), yIdx)
    : 0;

  let cpp = 0;
  if (s.in.cpp && age >= s.in.cpp.startAge) {
    const months = (s.in.cpp.startAge - 65) * 12;
    const factor = 1 + months * (months < 0
      ? policy.benefits.cppEarlyFactorPerMonth
      : policy.benefits.cppDeferralFactorPerMonth);
    cpp = s.in.cpp.annualAt65Today * factor * cpi;
  }
  // Scoped survivor CPP: flat boost (today’s $ × CPI) after first death
  if (s.cppSurvivorBoostToday > 0) cpp += s.cppSurvivorBoostToday * cpi;
  let oasGross = 0;
  if (s.in.oas && age >= s.in.oas.startAge) {
    const months = Math.max(0, (s.in.oas.startAge - 65) * 12);
    const deferral = 1 + months * policy.benefits.oasDeferralFactorPerMonth;
    const residence = Math.min(1, s.in.oas.residenceYears / policy.benefits.oasFullResidenceYears);
    const boost = age >= 75 ? 1 + policy.benefits.oasAge75Boost : 1;
    oasGross = policy.benefits.oasAnnualAt65 * residence * deferral * boost;
  }

  let db = 0;
  const dbStartAge = s.in.db?.startAge ?? s.in.retirementAge;
  // Pay only when entitlement is positive (avoids zero-dollar “DB on” noise).
  if (s.in.db && age >= dbStartAge && s.dbEntitlementToday > 0) {
    if (s.in.db.indexedToCpi ?? true) db = s.dbEntitlementToday * cpi;
    else {
      if (s.dbNominalAtStart === undefined) s.dbNominalAtStart = s.dbEntitlementToday * cpi;
      db = s.dbNominalAtStart;
    }
  }

  const contrib = { rrsp: 0, dc: 0, tfsa: 0, unregistered: 0 };
  if (working) {
    const wantDc = Math.min(spec$(s.in.savings?.dc, salary, cpi), policy.limits.moneyPurchaseLimit);
    contrib.dc = s.lifOpenedYear === undefined ? wantDc : 0;
    // Accrue only when a real DB plan is present with positive annual accrual.
    if (s.in.db?.accrualPerYearToday && s.in.db.accrualPerYearToday > 0) {
      s.dbEntitlementToday += s.in.db.accrualPerYearToday;
    }
    const wantRrsp = spec$(s.in.savings?.rrsp, salary, cpi);
    contrib.rrsp = s.rrifConvertedYear !== undefined ? 0 : Math.min(wantRrsp, s.rrspRoom);
    s.rrspRoom -= contrib.rrsp;
    let overflow = wantRrsp - contrib.rrsp;
    const wantTfsa = spec$(s.in.savings?.tfsa, salary, cpi) + overflow;
    contrib.tfsa = Math.min(wantTfsa, s.tfsaRoom);
    s.tfsaRoom -= contrib.tfsa;
    overflow = wantTfsa - contrib.tfsa;
    contrib.unregistered = spec$(s.in.savings?.unregistered, salary, cpi) + overflow;
  }
  let refundToTfsa = 0, refundToUnreg = 0;
  const refundReceived = s.pendingRefund;
  if (refundReceived > 0 && (s.in.reinvestRrspRefund ?? true)) {
    refundToTfsa = Math.min(refundReceived, s.tfsaRoom);
    s.tfsaRoom -= refundToTfsa;
    refundToUnreg = refundReceived - refundToTfsa;
  }
  s.pendingRefund = 0;
  contrib.tfsa += refundToTfsa;
  contrib.unregistered += refundToUnreg;

  // Forced minimums & LIF cap
  const ageJan1 = age - 1;
  const spouseAgeJan1 = (year - spouse.in.birthYear) - 1;
  const rrifAgeJan1 = (s.in.rrifUseYoungerSpouseAge ?? true) ? Math.min(ageJan1, spouseAgeJan1) : ageJan1;
  const rrifMin = s.rrifConvertedYear !== undefined && s.rrifConvertedYear < year
    ? Math.min(rrifMinFactor(rrifAgeJan1) * opening.rrsp, fundable(opening.rrsp, rr.rrsp)) : 0;
  const lifMin = s.lifOpenedYear !== undefined && s.lifOpenedYear < year
    ? Math.min(rrifMinFactor(rrifAgeJan1) * opening.lif, fundable(opening.lif, rr.lira)) : 0;
  const lifMax = s.lifOpenedYear !== undefined && opening.lif > 0
    ? Math.max(ontarioLifMaxFactor(age) * opening.lif, s.prevLifGrowth) : 0; // FSRA keys by age ATTAINED

  const dist = s.in.unregisteredDistribution ?? { interestFrac: 0, eligibleDividendFrac: 0, realizedGainFrac: 0 };
  const g = unregReturn * opening.unreg;
  const interest = dist.interestFrac * g;
  const dividends = dist.eligibleDividendFrac * g;
  const distributionGains = dist.realizedGainFrac * g;

  // GIS/payroll filled after streams for both persons when household flags are known;
  // placeholder here; simulate() patches via computeGisPayrollForYear when enabled.
  return {
    ageDec31: age, working, salary, cpp, oasGross, oasClawback: 0, db,
    gis: 0,
    payrollDeduction: 0,
    rrifMin, lifMin, lifMax,
    withdrawals: { unregistered: 0, registered: rrifMin, lif: lifMin, tfsa: 0, topUp: 0 },
    realizedGains: 0, interest, dividends, distributionGains,
    contributions: contrib, rrspDeduction: contrib.rrsp, refundReceived,
    taxableIncomePreSplit: 0,
    tax: { federal: 0, ontario: 0, clawback: 0, total: 0 },
    balancesEnd: { rrsp: 0, lira: s.lira, dcPension: 0, lif: 0, tfsa: 0, unregistered: 0, acb: 0 },
    roomsEnd: { rrsp: 0, tfsa: 0 },
  };
}

/** Design §6 step H for one person: mid-year growth, ACB, trackers. */
function applyGrowthFor(
  s: PState, p: PersonYear, opening: Opening, rr: Required<AccountReturns>,
  cpi: number, policy: YearPolicy
): void {
  const regFlow = p.contributions.rrsp - (p.withdrawals.registered + p.withdrawals.topUp);
  s.rrsp = Math.max(0, opening.rrsp * (1 + rr.rrsp) + regFlow * (1 + rr.rrsp / 2));
  s.lira = s.lira * (1 + rr.lira);
  s.dc = s.dc * (1 + rr.dcPension) + p.contributions.dc * (1 + rr.dcPension / 2);
  const lifFlow = -(p.withdrawals.lif);
  const lifEnd = Math.max(0, opening.lif * (1 + rr.lira) + lifFlow * (1 + rr.lira / 2));
  s.prevLifGrowth = Math.max(0, lifEnd - opening.lif - lifFlow);
  s.lif = lifEnd;
  const tfsaFlow = p.contributions.tfsa - p.withdrawals.tfsa;
  s.tfsa = Math.max(0, opening.tfsa * (1 + rr.tfsa) + tfsaFlow * (1 + rr.tfsa / 2));
  s.prevTfsaWithdrawals = p.withdrawals.tfsa;
  const uFlow = p.contributions.unregistered - p.withdrawals.unregistered;
  s.unreg = Math.max(0, opening.unreg * (1 + rr.unregistered) + uFlow * (1 + rr.unregistered / 2));
  const acbSold = opening.unreg > 0 ? p.withdrawals.unregistered * (opening.acb / opening.unreg) : 0;
  s.acb = Math.max(0, opening.acb + p.interest + p.dividends + p.distributionGains +
    p.contributions.unregistered - acbSold);
  s.prevEarnedIncome = p.salary;
  s.prevPa = p.working
    ? p.contributions.dc + (s.in.db?.accrualPerYearToday
        ? Math.max(0, 9 * s.in.db.accrualPerYearToday * cpi - policy.limits.paDbOffset) : 0)
    : 0;

  p.balancesEnd = { rrsp: s.rrsp, lira: s.lira, dcPension: s.dc, lif: s.lif, tfsa: s.tfsa, unregistered: s.unreg, acb: s.acb };
  p.roomsEnd = { rrsp: s.rrspRoom, tfsa: s.tfsaRoom };
}

// ---------------------------------------------------------------------------
// The simulator
// ---------------------------------------------------------------------------

export function simulate(input: HouseholdInput): SimulationResult {
  const startYear = input.startYear ?? 2026;
  const inflFixed = input.inflation ?? 0.021;
  const horizonAge = input.horizonAgeYoungerSpouse ?? 95;
  const tfsaLevel = resolveTfsaLevel(input.strategy?.tfsaLevel);
  const tfsaReserveYears = input.strategy?.tfsaReserveYears ?? 2;
  const tfsaFirstShare = input.strategy?.tfsaFirstShare ?? 0;
  const fastSolver = input.solverQuality === "fast";
  const path = input.path;

  const st: [PState, PState] = input.persons.map((p) => ({
    in: p,
    alive: true,
    cppSurvivorBoostToday: 0,
    rrsp: r(p.balances?.rrsp),
    lira: r(p.balances?.lira),
    dc: r(p.balances?.dcPension),
    lif: 0,
    tfsa: r(p.balances?.tfsa),
    unreg: r(p.balances?.unregistered?.balance),
    acb: r(p.balances?.unregistered?.acb),
    rrspRoom: r(p.rrspRoomNow),
    tfsaRoom: r(p.tfsaRoomNow),
    prevEarnedIncome: 0, prevPa: 0, prevTfsaWithdrawals: 0,
    pendingRefund: 0, prevLifGrowth: 0,
    dbEntitlementToday: r(p.db?.currentAnnualEntitlementToday),
  })) as [PState, PState];

  const surv = input.survivorship?.enabled ? input.survivorship : undefined;
  const firstDeathYear = surv?.firstDeathYear;
  const firstDeathPerson = surv?.firstDeathPerson ?? 0;
  const survivorSpendFrac = Math.min(1, Math.max(0.2, surv?.survivorSpendFrac ?? 0.7));

  const youngerBirth = Math.max(input.persons[0].birthYear, input.persons[1].birthYear);
  const endYear = input.yearsOverride
    ? startYear + input.yearsOverride - 1
    : youngerBirth + horizonAge;
  const firstRetYear = Math.min(
    input.persons[0].birthYear + input.persons[0].retirementAge,
    input.persons[1].birthYear + input.persons[1].retirementAge
  );

  const rows: YearRow[] = [];
  let lifetimeTax = 0;
  let failedAnyYear = false;
  let firstFailureYear: number | undefined;
  let lastIncomes: [PersonIncome, PersonIncome] | null = null;
  let lastPolicy: YearPolicy = buildYearPolicy(1);
  let cpi = 1;
  let prevW = -1; // warm-start bracket for the bisection
  let lastFullSplitYear = -1; // split-search cadence (full grid every 5 years or on demand)
  let prevSplitF = 0; let prevSplitDir: "AtoB" | "BtoA" | "none" = "none";
  let recordedFirstDeathYear: number | undefined;

  for (let year = startYear; year <= endYear; year++) {
    const yIdx = year - startYear;
    if (yIdx > 0) cpi *= 1 + (path?.inflationByYear?.[yIdx] ?? inflFixed);
    const policy = policyFor(cpi);
    lastPolicy = policy;
    const rrs: [Required<AccountReturns>, Required<AccountReturns>] = [
      resolveReturns(
        applyPortfolioSleeves(st[0].in.returns, input.portfolio),
        path?.returnsByYear?.[yIdx]?.[0]
      ),
      resolveReturns(
        applyPortfolioSleeves(st[1].in.returns, input.portfolio),
        path?.returnsByYear?.[yIdx]?.[1]
      ),
    ];

    // ---- A. Conversions (start of year) -----------------------------------
    for (const s of st) {
      if (!s.alive) continue;
      const age = year - s.in.birthYear;
      const rrifConvertAge = Math.min(71, Math.max(65, s.in.retirementAge));
      if (s.rrifConvertedYear === undefined && age >= rrifConvertAge)
        s.rrifConvertedYear = s.in.birthYear + rrifConvertAge;
      const lifConvertAge = Math.min(71, Math.max(55, s.in.retirementAge));
      if (s.lifOpenedYear === undefined && age >= lifConvertAge && (s.lira > 0 || s.dc > 0)) {
        let locked = s.lira + s.dc;
        s.lira = 0; s.dc = 0;
        if (s.in.lifUnlock50 ?? true) { s.rrsp += locked / 2; locked /= 2; }
        s.lif = locked;
        s.lifOpenedYear = s.in.birthYear + lifConvertAge;
      }
    }

    // ---- B. Room accrual ----------------------------------------------------
    if (yIdx > 0) {
      for (const s of st) {
        if (!s.alive) continue;
        const newRoom = Math.max(
          0,
          Math.min(policy.limits.rrspEarnedIncomeRate * s.prevEarnedIncome, policy.limits.rrspDollarLimit) - s.prevPa
        );
        s.rrspRoom += newRoom;
        s.tfsaRoom += policy.limits.tfsaAnnualLimit + s.prevTfsaWithdrawals;
      }
    }

    // ---- C. Streams & working-year contributions ---------------------------
    const py: PersonYear[] = [];
    const openings = [
      { rrsp: st[0].rrsp, lif: st[0].lif, tfsa: st[0].tfsa, unreg: st[0].unreg, acb: st[0].acb },
      { rrsp: st[1].rrsp, lif: st[1].lif, tfsa: st[1].tfsa, unreg: st[1].unreg, acb: st[1].acb },
    ];

    for (let i = 0; i < 2; i++) {
      py.push(streamsAndMins(st[i], st[1 - i], year, yIdx, cpi, policy, openings[i], rrs[i]));
    }

    // C2 / B6 — payroll & GIS (cash only; GIS tax-free)
    if (input.payroll?.enabled) {
      for (const p of py) {
        p.payrollDeduction = approxPayroll(p.salary, 74_600 * cpi);
      }
    }
    if (input.gis?.enabled) {
      const otherOf = (p: PersonYear) =>
        p.salary + p.cpp + p.db + p.interest + p.dividends + p.rrifMin + p.lifMin;
      const o0 = otherOf(py[0]);
      const o1 = otherOf(py[1]);
      py[0].gis = estimateGis({
        oasGross: py[0].oasGross,
        otherIncome: o0,
        spouseHasOas: py[1].oasGross > 0 && st[1].alive,
        spouseOtherIncome: o1,
        cpi,
      });
      py[1].gis = estimateGis({
        oasGross: py[1].oasGross,
        otherIncome: o1,
        spouseHasOas: py[0].oasGross > 0 && st[0].alive,
        spouseOtherIncome: o0,
        cpi,
      });
    }

    // ---- E. Solver ----------------------------------------------------------
    const solverActive = year >= firstRetYear;
    const afterFirstDeath =
      firstDeathYear != null && year > firstDeathYear;
    const spendMult = afterFirstDeath ? survivorSpendFrac : 1;
    const youngerAge = Math.min(
      year - input.persons[0].birthYear,
      year - input.persons[1].birthYear
    );
    const target = solverActive
      ? nominalSpendTarget(input, year, cpi, youngerAge) * spendMult
      : 0;

    // B5: sell home → 50/50 unregistered deposit
    if (shouldSellHousing(input.housing, year)) {
      const hv = housingValueNominal(input.housing, yIdx, cpi);
      const half = hv / 2;
      for (const i of [0, 1] as const) {
        if (!st[i].alive) continue;
        st[i].unreg += half;
        st[i].acb += half;
        openings[i].unreg = st[i].unreg;
        openings[i].acb = st[i].acb;
      }
    }

    const gf: [number, number] = [
      openings[0].unreg > 0 ? Math.max(0, 1 - openings[0].acb / openings[0].unreg) : 0,
      openings[1].unreg > 0 ? Math.max(0, 1 - openings[1].acb / openings[1].unreg) : 0,
    ];
    const caps = [0, 1].map((i) => ({
      unreg: fundable(openings[i].unreg, rrs[i].unregistered),
      reg: Math.max(0, fundable(openings[i].rrsp, rrs[i].rrsp) - py[i].rrifMin),
      lif: Math.max(0, Math.min(py[i].lifMax, fundable(openings[i].lif, rrs[i].lira)) - py[i].lifMin),
      tfsa: fundable(openings[i].tfsa, rrs[i].tfsa),
    }));
    const yearCeiling = effectiveYearCeiling(
      input.strategy,
      py[0].ageDec31,
      py[1].ageDec31,
      cpi,
      policy.federal.oasClawbackThreshold
    );
    const ctx: YearCtx = {
      policy, py, caps,
      gainFrac: gf,
      rrifMode: [st[0].rrifConvertedYear !== undefined, st[1].rrifConvertedYear !== undefined],
      baseTaxable: [0, 0],
      incomeCeiling: yearCeiling,
      tfsaLevel,
      tfsaReserveTotal: 0,
      tfsaFirstShare,
    };
    ctx.baseTaxable = [
      computeTax(buildIncomeFor(ctx, 0, 0, 0, 0, 0), {}, policy, true).taxableIncome,
      computeTax(buildIncomeFor(ctx, 1, 0, 0, 0, 0), {}, policy, true).taxableIncome,
    ];
    ctx.tfsaReserveTotal = tfsaReserveDollars(
      tfsaLevel,
      tfsaReserveYears,
      target,
      caps[0].tfsa + caps[1].tfsa
    );
    const p0 = py[0], p1 = py[1];
    const fixedCashIn =
      p0.salary + p0.cpp + p0.oasGross + p0.db + p0.gis + p0.refundReceived + p0.rrifMin + p0.lifMin -
      p0.payrollDeduction +
      p1.salary + p1.cpp + p1.oasGross + p1.db + p1.gis + p1.refundReceived + p1.rrifMin + p1.lifMin -
      p1.payrollDeduction;
    const plannedContrib =
      p0.contributions.rrsp + p0.contributions.dc + p0.contributions.tfsa + p0.contributions.unregistered +
      p1.contributions.rrsp + p1.contributions.dc + p1.contributions.tfsa + p1.contributions.unregistered;

    // Split at the base point — full 0.1%-precision search on a cadence
    // (first solver year, every 5th year, or when the local refine rides its
    // window edge); cheap local refinement of last year's optimum otherwise.
    const baseInc0 = buildIncomeFor(ctx, 0, 0, 0, 0, 0);
    const baseInc1 = buildIncomeFor(ctx, 1, 0, 0, 0, 0);
    let split: SplitChoice;
    const wantFull = solverActive && (lastFullSplitYear < 0 || year - lastFullSplitYear >= 5 || prevSplitDir === "none");
    if (wantFull) {
      split = searchSplitFull(policy, baseInc0, baseInc1);
      lastFullSplitYear = year;
    } else if (fastSolver) {
      // seed from last year's optimum; the post-solve local refine (below)
      // corrects drift, and edge-riding there re-anchors with a full search
      split = { f: prevSplitF, dir: prevSplitDir, total: taxPairAt(policy, baseInc0, baseInc1, prevSplitF, prevSplitDir) };
    } else {
      split = searchSplitLocal(policy, baseInc0, baseInc1, prevSplitF, prevSplitDir, 0.10, 0.01);
      if (Math.abs(split.f - prevSplitF) >= 0.10 - 1e-9) { // rode the window edge — re-anchor
        split = searchSplitFull(policy, baseInc0, baseInc1);
        lastFullSplitYear = year;
      }
    }

    let W = 0;
    let ev = evaluateW(ctx, 0, split.f, split.dir, 0, 0, fixedCashIn, plannedContrib);
    let failed = false, shortfall = 0;

    if (solverActive && ev.afterTaxCash < target - 1) {
      const Wmax = caps[0].unreg + caps[0].reg + caps[0].lif + caps[0].tfsa +
                   caps[1].unreg + caps[1].reg + caps[1].lif + caps[1].tfsa;
      const evMax = evaluateW(ctx, Wmax, split.f, split.dir, 0, 0, fixedCashIn, plannedContrib);
      if (evMax.afterTaxCash < target - 1) {
        // even everything is not enough — refine the split at Wmax, record failure
        split = searchSplitLocal(policy, evMax.inc[0], evMax.inc[1], split.f, split.dir, 0.05, 0.01);
        const evF = evaluateW(ctx, Wmax, split.f, split.dir, 0, 0, fixedCashIn, plannedContrib);
        failed = true; shortfall = target - evF.afterTaxCash; W = Wmax; ev = evF;
      } else {
        // warm bracket from last year's W; solveWRoot expands it if needed
        const lo = prevW > 0 ? Math.max(0, 0.5 * prevW) : 0;
        const hi = prevW > 0 ? Math.min(Wmax, 1.7 * prevW + 10_000) : Wmax;
        W = solveWRoot(ctx, lo, hi, Wmax, split.f, split.dir, target, fixedCashIn, plannedContrib);
        ev = evaluateW(ctx, W, split.f, split.dir, 0, 0, fixedCashIn, plannedContrib);
        // refine split at the solved point; re-bracket narrowly if it moved
        let refined = split.dir === "none"
          ? searchSplitFull(policy, ev.inc[0], ev.inc[1])
          : searchSplitLocal(policy, ev.inc[0], ev.inc[1], split.f, split.dir, 0.05, 0.01);
        if (refined.dir !== "none" && Math.abs(refined.f - split.f) >= 0.05 - 1e-9) {
          refined = searchSplitFull(policy, ev.inc[0], ev.inc[1]); // rode the edge — re-anchor
          lastFullSplitYear = year;
        }
        if (Math.abs(refined.f - split.f) > 0.011 || refined.dir !== split.dir) {
          split = refined;
          W = solveWRoot(ctx, Math.max(0, W * 0.9), Math.min(Wmax, W * 1.1 + 1_000), Wmax, split.f, split.dir, target, fixedCashIn, plannedContrib);
          ev = evaluateW(ctx, W, split.f, split.dir, 0, 0, fixedCashIn, plannedContrib);
          const polish = split.dir === "none"
            ? searchSplitFull(policy, ev.inc[0], ev.inc[1])
            : searchSplitLocal(policy, ev.inc[0], ev.inc[1], split.f, split.dir, 0.02, 0.005);
          ev.afterTaxCash += ev.totalTax - polish.total;
          ev.totalTax = polish.total;
          split = polish;
        } else {
          // same W and identical allocations — only the tax total changed
          ev.afterTaxCash += ev.totalTax - refined.total;
          ev.totalTax = refined.total;
          split = refined;
        }
      }
    }
    prevW = solverActive && !failed ? W : prevW;
    if (solverActive) { prevSplitF = split.f; prevSplitDir = split.dir; }

    // Phase 2 — person-aware top-ups under (possibly person-specific) ceilings
    const oasThr = policy.federal.oasClawbackThreshold;
    const soft = input.strategy?.oasSoftCap !== false;
    const personCToday = input.strategy?.personCeilingsToday;
    const ceilYear: [number, number] = personCToday
      ? [
          soft
            ? Math.min(personCToday[0] * cpi, oasThr)
            : personCToday[0] * cpi,
          soft
            ? Math.min(personCToday[1] * cpi, oasThr)
            : personCToday[1] * cpi,
        ]
      : [yearCeiling, yearCeiling];

    const regBal: [number, number] = [
      openings[0].rrsp + openings[0].lif,
      openings[1].rrsp + openings[1].lif,
    ];
    const order = personOrder(input.strategy?.topUpPriority, regBal[0], regBal[1]);

    let topUps: [number, number] = [0, 0];
    if (solverActive && (ceilYear[0] > 0 || ceilYear[1] > 0) && !failed) {
      const pre: [number, number] = [
        computeTax(ev.inc[0], {}, policy, true).taxableIncome,
        computeTax(ev.inc[1], {}, policy, true).taxableIncome,
      ];
      const regLeft: [number, number] = [
        Math.max(0, caps[0].reg - ev.tR[0]),
        Math.max(0, caps[1].reg - ev.tR[1]),
      ];
      topUps = assignPersonTopUps(ceilYear, pre, regLeft, order);

      // Aggressive TFSA use: only melt what can land in TFSA after rough tax
      if (input.strategy?.tfsaAwareMeltdown !== false) {
        const roomTot =
          (st[0].alive ? st[0].tfsaRoom : 0) + (st[1].alive ? st[1].tfsaRoom : 0);
        topUps = scaleTopUpsToTfsaRoom(topUps, roomTot, 0.65);
      }

      if (topUps[0] + topUps[1] > 0) {
        ev = evaluateW(ctx, W, split.f, split.dir, topUps[0], topUps[1], fixedCashIn, plannedContrib);
        const s2 = wantFull
          ? searchSplitFull(policy, ev.inc[0], ev.inc[1])
          : searchSplitLocal(policy, ev.inc[0], ev.inc[1], split.f, split.dir, 0.10, 0.01);
        ev.afterTaxCash += ev.totalTax - s2.total;
        ev.totalTax = s2.total;
        split = s2;
      }
    }

    // ---- F/G. Final taxes (full results), surplus routing, conservation ----
    const finalPair = finalizePair(policy, ev.inc[0], ev.inc[1], split.f, split.dir);
    const householdTax = finalPair.a.totalTax + finalPair.b.totalTax;

    const afterTaxCash = ev.afterTaxCash + (ev.totalTax - householdTax); // lean vs full identical; keep exact
    const surplus = solverActive ? Math.max(0, afterTaxCash - target) : 0;
    const spendingAchieved = solverActive ? Math.min(target, afterTaxCash) : 0;
    let surplusToTfsa = 0, surplusToUnreg = 0;
    if (surplus > 0) {
      const parked = parkSurplusTfsaFirst(
        surplus,
        [st[0].tfsaRoom, st[1].tfsaRoom],
        [st[0].alive, st[1].alive]
      );
      const tfsaAdd = parked.tfsaAdd;
      let leftS = parked.residual;
      st[0].tfsaRoom = Math.max(0, st[0].tfsaRoom - tfsaAdd[0]);
      st[1].tfsaRoom = Math.max(0, st[1].tfsaRoom - tfsaAdd[1]);
      surplusToTfsa = tfsaAdd[0] + tfsaAdd[1];
      surplusToUnreg = leftS;
      py[0].contributions.tfsa += tfsaAdd[0];
      py[1].contributions.tfsa += tfsaAdd[1];
      // Unregistered residual: prefer the spouse with more existing unreg (tax location), else 50/50
      if (leftS > 0) {
        const u0 = st[0].alive ? openings[0].unreg : 0;
        const u1 = st[1].alive ? openings[1].unreg : 0;
        if (st[0].alive && st[1].alive) {
          const share0 = u0 + u1 > 1e-6 ? u0 / (u0 + u1) : 0.5;
          py[0].contributions.unregistered += leftS * share0;
          py[1].contributions.unregistered += leftS * (1 - share0);
        } else if (st[0].alive) {
          py[0].contributions.unregistered += leftS;
        } else if (st[1].alive) {
          py[1].contributions.unregistered += leftS;
        }
      }
    }

    lifetimeTax += householdTax;
    const results = [finalPair.a, finalPair.b];
    const rawResults = [finalPair.aRaw, finalPair.bRaw];
    for (const i of [0, 1]) {
      const p = py[i];
      p.withdrawals.unregistered = ev.tU[i];
      p.withdrawals.registered = p.rrifMin + ev.tR[i];
      p.withdrawals.lif = p.lifMin + ev.tL[i];
      p.withdrawals.tfsa = ev.tT[i];
      p.withdrawals.topUp = topUps[i];
      p.realizedGains = p.distributionGains + ev.tU[i] * gf[i];
      p.oasClawback = results[i].oasClawback;
      p.taxableIncomePreSplit = computeTax(ev.inc[i], {}, policy, true).taxableIncome;
      p.tax = {
        federal: results[i].federalTax, ontario: results[i].ontarioTax,
        clawback: results[i].oasClawback, total: results[i].totalTax,
      };
      // RRSP refund is individual (pre spousal credit transfer) so the
      // deduction's own tax value is not mixed with spouse unused credits.
      if (p.rrspDeduction > 0) {
        const noDed = computeTax({ ...ev.inc[i], rrspDeduction: 0 }, {}, policy, true).totalTax;
        st[i].pendingRefund = Math.max(0, noDed - rawResults[i].totalTax);
      }
    }

    const cashIn =
      p0.salary + p0.cpp + p0.oasGross + p0.db + p0.gis + p0.refundReceived +
      p0.withdrawals.unregistered + p0.withdrawals.registered + p0.withdrawals.lif + p0.withdrawals.tfsa + p0.withdrawals.topUp +
      p1.salary + p1.cpp + p1.oasGross + p1.db + p1.gis + p1.refundReceived +
      p1.withdrawals.unregistered + p1.withdrawals.registered + p1.withdrawals.lif + p1.withdrawals.tfsa + p1.withdrawals.topUp;
    const cashOut = householdTax + spendingAchieved + p0.payrollDeduction + p1.payrollDeduction +
      p0.contributions.rrsp + p0.contributions.dc + p0.contributions.tfsa + p0.contributions.unregistered +
      p1.contributions.rrsp + p1.contributions.dc + p1.contributions.tfsa + p1.contributions.unregistered;
    const conservationResidual = solverActive ? cashIn - cashOut : 0;

    // ---- H. Apply growth (mid-year on net flows), update state -------------
    for (const i of [0, 1]) {
      if (st[i].alive) applyGrowthFor(st[i], py[i], openings[i], rrs[i], cpi, policy);
      else {
        // Keep zeroed dead balances on the year record
        py[i].balancesEnd = {
          rrsp: st[i].rrsp, lira: st[i].lira, dcPension: st[i].dc, lif: st[i].lif,
          tfsa: st[i].tfsa, unregistered: st[i].unreg, acb: st[i].acb,
        };
        py[i].roomsEnd = { rrsp: st[i].rrspRoom, tfsa: st[i].tfsaRoom };
      }
    }

    // ---- B2: first death at end of designated year (after growth) ----------
    if (
      surv &&
      firstDeathYear != null &&
      year === firstDeathYear &&
      st[firstDeathPerson].alive &&
      st[1 - firstDeathPerson].alive
    ) {
      const d = firstDeathPerson as 0 | 1;
      const sIdx = (1 - d) as 0 | 1;
      const dead = st[d];
      const live = st[sIdx];
      // Tax-free RRSP/RRIF/LIF/LIRA/DC rollover to survivor RRSP (simplified)
      live.rrsp += dead.rrsp + dead.lira + dead.dc + dead.lif;
      dead.rrsp = 0; dead.lira = 0; dead.dc = 0; dead.lif = 0;
      // TFSA: transfer into survivor room, overflow to unregistered
      let tfsaXfer = dead.tfsa;
      dead.tfsa = 0;
      const toRoom = Math.min(tfsaXfer, live.tfsaRoom);
      live.tfsa += toRoom;
      live.tfsaRoom -= toRoom;
      tfsaXfer -= toRoom;
      if (tfsaXfer > 0) {
        live.unreg += tfsaXfer;
        // cost base ≈ market for transferred TFSA cash into unreg
        live.acb += tfsaXfer;
      }
      // Unregistered: transfer with ACB
      live.unreg += dead.unreg;
      live.acb += dead.acb;
      dead.unreg = 0;
      dead.acb = 0;
      // CPP survivor boost ~60% of deceased annual CPP at 65 base (scoped)
      const baseCpp = dead.in.cpp?.annualAt65Today ?? 0;
      live.cppSurvivorBoostToday += 0.6 * baseCpp;
      dead.alive = false;
      dead.rrspRoom = 0;
      dead.tfsaRoom = 0;
      // Refresh year-end balances on the death-year row for both persons
      for (const i of [0, 1] as const) {
        py[i].balancesEnd = {
          rrsp: st[i].rrsp, lira: st[i].lira, dcPension: st[i].dc, lif: st[i].lif,
          tfsa: st[i].tfsa, unregistered: st[i].unreg, acb: st[i].acb,
        };
      }
      recordedFirstDeathYear = year;
    }

    if (failed && !failedAnyYear) { failedAnyYear = true; firstFailureYear = year; }
    lastIncomes = ev.inc;

    rows.push({
      year, cpiIndex: cpi, solverActive,
      spendingTarget: target, spendingAchieved, failed, shortfall,
      surplusToTfsa, surplusToUnregistered: surplusToUnreg,
      splitDirection: split.dir, splitAmount: finalPair.splitAmount,
      householdTax, conservationResidual,
      persons: [py[0], py[1]] as [PersonYear, PersonYear],
    });
  }

  // ---- Estate at horizon (living spouses only) ------------------------------
  let estateTax = 0, gross = 0;
  const finalBalances = [0, 1].map((i) => rows[rows.length - 1].persons[i].balancesEnd);
  for (const i of [0, 1] as const) {
    if (!st[i].alive) continue;
    const b = finalBalances[i];
    gross += b.rrsp + b.lira + b.dcPension + b.lif + b.tfsa + b.unregistered;
    const registered = b.rrsp + b.lira + b.dcPension + b.lif;
    const deemedGain = Math.max(0, b.unregistered - b.acb);
    const baseInc = lastIncomes ? lastIncomes[i] : { ageDec31: endYear - st[i].in.birthYear };
    const withEstate = computeTax({
      ...baseInc,
      rrspWithdrawal: (baseInc.rrspWithdrawal ?? 0) + registered,
      realizedCapitalGains: (baseInc.realizedCapitalGains ?? 0) + deemedGain,
    }, {}, lastPolicy).totalTax;
    const actual = computeTax(baseInc as PersonIncome, {}, lastPolicy).totalTax;
    estateTax += withEstate - actual;
  }
  // Deceased should hold ~0; include any residual in gross for conservation
  for (const i of [0, 1] as const) {
    if (st[i].alive) continue;
    const b = finalBalances[i];
    gross += b.rrsp + b.lira + b.dcPension + b.lif + b.tfsa + b.unregistered;
  }

  // B5: principal residence in estate (tax-free) if still held
  const finalCpi = rows[rows.length - 1].cpiIndex;
  const sold =
    input.housing?.enabled &&
    input.housing.sellYear != null &&
    input.housing.sellYear >= startYear &&
    input.housing.sellYear <= endYear;
  let housingEstateNominal = 0;
  if (includeHousingInEstate(input.housing, !!sold)) {
    housingEstateNominal = housingValueNominal(
      input.housing,
      endYear - startYear,
      finalCpi
    );
    gross += housingEstateNominal;
  }

  const afterTaxEstate = gross - estateTax;
  // Ontario EAT sketch on after-tax estate (housing already in gross / after-tax).
  // Not subtracted from afterTaxEstate so strategy search stays comparable; surfaced for UI.
  const estateAdminTax = ontarioEstateAdminTax(Math.max(0, afterTaxEstate));

  return {
    rows, failedAnyYear, firstFailureYear, lifetimeTax,
    finalBalances: { total: gross, byPerson: finalBalances },
    afterTaxEstate,
    afterTaxEstateReal: afterTaxEstate / finalCpi,
    firstDeathYear: recordedFirstDeathYear,
    firstDeathPerson: recordedFirstDeathYear != null ? firstDeathPerson : undefined,
    housingEstateNominal: housingEstateNominal > 0 ? housingEstateNominal : undefined,
    housingEstateReal:
      housingEstateNominal > 0 ? housingEstateNominal / finalCpi : undefined,
    estateAdminTax: estateAdminTax > 0 ? estateAdminTax : undefined,
    estateAdminTaxReal: estateAdminTax > 0 ? estateAdminTax / finalCpi : undefined,
  };
}
