/**
 * constants-2026.ts — Policy constants for the Ontario Couple Retirement Planner
 * =============================================================================
 * Gate 0 deliverable (design doc §13). Every entry carries its source and the
 * date it was retrieved. Retrieved: 2026-07-19.
 *
 * Indexation convention (design §9.2): the simulator indexes every parameter
 * flagged `indexed: "cpi"` along the simulated CPI path from these 2026 bases.
 * Parameters flagged `indexed: "frozen"` never move — this captures real
 * bracket creep (e.g. Ontario Health Premium bands, federal pension amount).
 * `indexed: "wage"` parameters (RRSP/MP limits, YMPE) actually track average
 * wage growth; v1 indexes them at CPI as a documented simplification (§17).
 *
 * Primary sources:
 *  [CRA-IDX]  canada.ca — Indexation adjustment for personal income tax and
 *             benefit amounts (page updated 2026-03-12)
 *  [CRA-LIM]  canada.ca — MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE/YAMPE
 *  [T4032ON]  canada.ca — Payroll Deductions Tables, Ontario, January 2026
 *  [TD1ON]    CRA Form TD1ON, 2026 Ontario Personal Tax Credits Return
 *  [ESDC-Q3]  canada.ca — Maximum benefit amounts, CPP 2026 & OAS Jul–Sep 2026
 *  [CPP-AMT]  canada.ca — CPP monthly payment amounts (updated 2026-03-31)
 *  [FIN-C4]   canada.ca — Dept. of Finance report on Bill C-4 (Royal Assent
 *             2026-03-12): lowest rate 14.5% (2025), 14% (2026+); credits
 *             convert at the lowest rate; temporary Top-Up Tax Credit 2025–2030
 *  [PMO-CG]   pm.gc.ca 2025-03-21 — capital gains inclusion increase cancelled
 *  [KPMG-26]  KPMG, Federal & provincial rates/brackets 2026 (as of 2025-12-31)
 *  [EY-ON26]  EY Ontario 2026 combined-rates PDF (as of 2026-06-15)
 *  [LIF-26]   lifeannuities.com 2026 LIF min/max table (compiled from FSRA and
 *             other regulators) — RE-VERIFY against FSRA directly at Gate 1
 */

export type Indexation = "cpi" | "frozen" | "wage";

export interface Sourced<T> {
  value: T;
  source: string;
  retrievedOn: string; // ISO date
  indexed: Indexation;
  note?: string;
}

const RETRIEVED = "2026-07-19";
const src = <T>(value: T, source: string, indexed: Indexation, note?: string): Sourced<T> => ({
  value, source, retrievedOn: RETRIEVED, indexed, ...(note ? { note } : {}),
});

// ---------------------------------------------------------------------------
// 1. FEDERAL INCOME TAX — 2026
// ---------------------------------------------------------------------------

/** Bracket = tax rate applied to taxable income above `from` (up to next bracket). */
export interface Bracket { from: number; rate: number; }

export const FEDERAL = {
  /** [CRA-IDX] thresholds; [FIN-C4]/[KPMG-26] rates (Bill C-4: 14% from 2026). */
  brackets: src<Bracket[]>(
    [
      { from: 0,       rate: 0.14  },
      { from: 58_523,  rate: 0.205 },
      { from: 117_045, rate: 0.26  },
      { from: 181_440, rate: 0.29  },
      { from: 258_482, rate: 0.33  },
    ],
    "[CRA-IDX] + [FIN-C4] + [KPMG-26]", "cpi",
    "Thresholds CPI-indexed (2.0% factor for 2026); rates are policy, not indexed."
  ),

  /** [FIN-C4] Non-refundable credits convert at the lowest rate: 14% for 2026. */
  creditRate: src(0.14, "[FIN-C4]", "frozen",
    "Top-Up Tax Credit (2025–2030) preserves 15% on credit amounts above the " +
    "first bracket threshold — immaterial for this app's income mix (BPA + age " +
    "+ pension ≈ $28k ≪ $58,523); not modelled, per design §17."
  ),

  /** [CRA-IDX] Basic personal amount: base + enhancement with linear phase-out. */
  bpa: {
    max: src(16_452, "[CRA-IDX]", "cpi"),        // net income ≤ 29% threshold
    base: src(14_829, "[CRA-IDX]", "cpi"),       // net income ≥ 33% threshold
    enhancement: src(1_623, "[CRA-IDX]", "cpi"), // = max − base
    phaseOutStart: src(181_440, "[CRA-IDX]", "cpi"),
    phaseOutEnd: src(258_482, "[CRA-IDX]", "cpi"),
  },

  /** [CRA-IDX] Age amount (65+), 15% phase-out above threshold (nil ≈ $107,819 [EY-ON26]). */
  ageAmount: src(9_208, "[CRA-IDX]", "cpi"),
  ageAmountThreshold: src(46_432, "[CRA-IDX]", "cpi"),
  ageAmountPhaseOutRate: src(0.15, "[EY-ON26]", "frozen"),

  /** Pension income amount — unchanged since 2006. */
  pensionIncomeAmount: src(2_000, "ITA s.118(3); corroborated in 2026 planning sources", "frozen"),

  /** Eligible dividends. Rates unchanged since 2012. [KPMG-26]/TaxTips corroborated. */
  eligibleDividend: {
    grossUp: src(0.38, "[KPMG-26]/TaxTips", "frozen"),
    dtcOnGrossedUp: src(0.150198, "[KPMG-26]/TaxTips", "frozen"),
  },

  /** [PMO-CG] Proposed 2/3 increase cancelled 2025-03-21; 50% stands for 2026. */
  capitalGainsInclusion: src(0.5, "[PMO-CG]", "frozen"),

  /** [CRA-IDX]/[ESDC-Q3] OAS recovery tax on individual net income. */
  oasClawback: {
    threshold: src(95_323, "[CRA-IDX]", "cpi", "2026 income year."),
    rate: src(0.15, "[ESDC-Q3]", "frozen"),
    // Design §17: modelled as same-year liability; real mechanism uses the
    // July–June recovery period based on prior-year income.
  },
} as const;

// ---------------------------------------------------------------------------
// 2. ONTARIO INCOME TAX — 2026
// ---------------------------------------------------------------------------

export const ONTARIO = {
  /** [KPMG-26]; ON indexation factor 1.9% [T4032ON]. Top two thresholds FROZEN. */
  brackets: src<Bracket[]>(
    [
      { from: 0,       rate: 0.0505 },
      { from: 53_891,  rate: 0.0915 },
      { from: 107_785, rate: 0.1116 },
      { from: 150_000, rate: 0.1216 }, // frozen since 2014
      { from: 220_000, rate: 0.1316 }, // frozen since 2014
    ],
    "[KPMG-26] + [T4032ON]", "cpi",
    "Engine must index ONLY the $53,891 and $107,785 thresholds; $150,000 and " +
    "$220,000 are statutorily frozen (TaxTips-corroborated)."
  ),

  creditRate: src(0.0505, "[T4032ON]", "frozen"),

  /** [T4032ON] Surtax on Ontario basic tax (i.e., tax after ON credits, before surtax). */
  surtax: {
    tier1Threshold: src(5_818, "[T4032ON]", "cpi"),
    tier1Rate: src(0.20, "[T4032ON]", "frozen"),
    tier2Threshold: src(7_446, "[T4032ON]", "cpi"),
    tier2Rate: src(0.36, "[T4032ON]", "frozen"),
  },

  /** [T4032ON] Ontario Health Premium — bands FROZEN since 2004. Piecewise on taxable income. */
  healthPremium: src(
    [
      { over: 20_000,  cap: 300, rate: 0.06, base: 0   },
      { over: 36_000,  cap: 450, rate: 0.06, base: 300 },
      { over: 48_000,  cap: 600, rate: 0.25, base: 450 },
      { over: 72_000,  cap: 750, rate: 0.25, base: 600 },
      { over: 200_000, cap: 900, rate: 0.25, base: 750 },
    ],
    "[T4032ON] (first three bands verbatim; last two per the standard published " +
    "structure, max $900 [EY-ON26]) — assert all five bands in G1 unit tests.",
    "frozen",
    "premium(TI) = for the highest band with TI > over: min(cap, base + rate × (TI − over)); 0 if TI ≤ 20,000."
  ),

  bpa: src(12_989, "[T4032ON]", "cpi"),

  /** [TD1ON] Age amount 65+: $6,342; phase-out 15% above $47,210 (nil at $89,490 [EY-ON26]). */
  ageAmount: src(6_342, "[TD1ON]", "cpi"),
  ageAmountThreshold: src(47_210, "[TD1ON]", "cpi"),
  ageAmountPhaseOutRate: src(0.15, "[EY-ON26]", "frozen"),

  /** [TD1ON] Ontario pension income amount. */
  pensionIncomeAmount: src(1_796, "[TD1ON]", "cpi"),

  /** Ontario eligible-dividend tax credit: 10% of the grossed-up dividend. */
  eligibleDividendDtcOnGrossedUp: src(0.10, "TaxTips/worked examples, stable for years", "frozen"),

  /**
   * [T4032ON]/[EY-ON26] Ontario Tax Reduction: max(0, 2 × basic − ON tax incl.
   * surtax), capped at that tax. Verified: zeroes ON tax to TI $18,930, claws
   * back at 5.05-pt equivalent to TI $24,870 (2026) — matches [EY-ON26] note 6.
   */
  taxReductionBasic: src(300, "[T4032ON] + [EY-ON26]", "cpi"),
} as const;

// ---------------------------------------------------------------------------
// 3. REGISTERED-PLAN LIMITS & ROOM FORMULAS — 2026
// ---------------------------------------------------------------------------

export const LIMITS = {
  rrspDollarLimit: src(33_810, "[CRA-LIM]", "wage", "2027: $35,390 (announced)."),
  rrspEarnedIncomeRate: src(0.18, "[CRA-LIM]/T4040", "frozen"),
  moneyPurchaseLimit: src(35_390, "[CRA-LIM]", "wage", "Caps DC pension PA."),
  dbLimit: src(3_932.22, "[CRA-LIM]", "wage", "Max DB accrual per year of service (= MP/9)."),
  tfsaAnnualLimit: src(7_000, "[CRA-IDX]", "cpi",
    "Statutory: $5,000 base indexed from 2009, rounded to nearest $500 " +
    "(unrounded 2026 amount $7,185). v1 indexes smoothly per design §17."),
  ympe: src(74_600, "[CRA-LIM]", "wage"),
  yampe: src(85_000, "[CRA-LIM]", "wage", "CPP2 earnings band is YMPE→YAMPE."),

  /** Pension Adjustment formulas (design §6 step 2). */
  paDbFormula: src("PA = 9 × benefit_accrued − 600", "CRA T4084 PA Guide (standard formula)", "frozen",
    "$600 offset is statutory and frozen."),
  paDcFormula: src("PA = total employer + employee DC contributions", "CRA T4084 PA Guide", "frozen"),
} as const;

// ---------------------------------------------------------------------------
// 4. GOVERNMENT BENEFITS — 2026
// ---------------------------------------------------------------------------

export const CPP = {
  /** [CPP-AMT] Benefits beginning January 2026. */
  maxMonthlyAt65: src(1_507.65, "[CPP-AMT]", "cpi",
    "Annual $18,091.80. Rises slightly each month from the 2019+ enhancement; " +
    "engine treats the user's Service Canada estimate as the source of truth."),
  averageNewMonthlyAt65: src(925.35, "[CPP-AMT]", "cpi", "UI default suggestion ≈ 61% of max."),
  earlyFactorPerMonth: src(0.006, "canada.ca / multiple corroborating sources", "frozen",
    "−0.6%/mo before 65; max −36% at 60."),
  deferralFactorPerMonth: src(0.007, "canada.ca / multiple corroborating sources", "frozen",
    "+0.7%/mo after 65; max +42% at 70."),
  startAgeRange: src({ min: 60, max: 70 }, "canada.ca", "frozen"),
  indexation: src("annual (January), CPI", "canada.ca", "frozen"),
} as const;

export const OAS = {
  /** [ESDC-Q3] July–September 2026 quarter (quarterly CPI indexation; modelled annually per §17). */
  maxMonthly65to74: src(751.97, "[ESDC-Q3]", "cpi", "Annualized ≈ $9,023.64."),
  maxMonthly75plus: src(827.17, "[ESDC-Q3]", "cpi"),
  age75Boost: src(0.10, "canada.ca — permanent 10% increase at 75 since July 2022", "frozen"),
  deferralFactorPerMonth: src(0.006, "[ESDC-Q3]", "frozen", "+0.6%/mo, max +36% at 70."),
  startAgeRange: src({ min: 65, max: 70 }, "canada.ca", "frozen"),
  fullResidenceYears: src(40, "canada.ca", "frozen", "Benefit prorated by residence years / 40."),
  // Clawback parameters live in FEDERAL.oasClawback (it's a federal recovery tax).
} as const;

// ---------------------------------------------------------------------------
// 5. RRIF MINIMUMS (also the LIF minimum) — prescribed factors, stable since 2015
// ---------------------------------------------------------------------------

/**
 * Source: CRA "Chart – Prescribed factors"; corroborated by TD/TaxTips/CIBC.
 * Key: age at the BEGINNING of the calendar year (Jan 1). Below 71: 1/(90−age).
 * Younger-spouse election (made at RRIF setup, permanent) substitutes the
 * spouse's age. A Jan-2026 proposal to cut minimums 25% for one year did NOT
 * proceed (TaxTips) — no change for 2026.
 */
export const RRIF_MIN_FACTOR: Record<number, number> = {
  71: 0.0528, 72: 0.0540, 73: 0.0553, 74: 0.0567, 75: 0.0582,
  76: 0.0598, 77: 0.0617, 78: 0.0636, 79: 0.0658, 80: 0.0682,
  81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808, 85: 0.0851,
  86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192,
  91: 0.1306, 92: 0.1449, 93: 0.1634, 94: 0.1879,
};
export const rrifMinFactor = (ageJan1: number): number =>
  ageJan1 >= 95 ? 0.20 : ageJan1 >= 71 ? RRIF_MIN_FACTOR[ageJan1] : ageJan1 >= 0 ? 1 / (90 - ageJan1) : 0;

// ---------------------------------------------------------------------------
// 6. ONTARIO LIF MAXIMUMS — 2026 (Schedule 1.1 LIFs)
// ---------------------------------------------------------------------------

/**
 * Source: [LIF-26] Ontario column (ON/NB/SK/NL/BC/AB group), ages 50–100, as at
 * Jan 1 2026. RE-VERIFY against FSRA's own published percentages at Gate 1.
 * Rule: annual maximum = max(factor × Jan-1 balance, prior year's investment
 * return on the LIF). Ontario's formula floors the discount rate at 6%, so the
 * table is stable across years while market reference rates sit below 6%
 * (2026 reference rate: 3.49%) — v1 holds this table constant for future years
 * (design §17 simplification). Ontario also permits a one-time 50% unlock to an
 * RRSP/RRIF within 60 days of LIF purchase (design §7.1).
 */
/**
 * Ontario LIF/LRIF MAXIMUM annual payment — exact percentages from FSRA
 * guidance PE0196INF, Appendix A ("Maximum annual income payment amount
 * table"), keyed by AGE ATTAINED DURING THE YEAR. [FSRA-LIFMAX]
 * https://www.fsrao.ca/industry/pensions/regulatory-framework/guidance-pensions/life-income-fund-lif-and-locked-retirement-income-fund-lrif-maximum-annual-income-payment-amount-table
 * retrievedOn: 2026-07-19 (guidance effective 2021-01-01, applies "for any
 * year" unless the Nov CANSIM V122487 long-bond rate exceeds 6.00% — the
 * C/F formula uses max(rate, 6%), and the rate has been below 6% for decades,
 * so the table is constant under current conditions).
 * The statutory maximum each year is the GREATER of (factor x Jan-1 balance)
 * and the previous fiscal year's investment earnings incl. unrealized
 * gains/losses (Reg. 909 Sch. 1.1 s.6) — both implemented in simulate.ts.
 */
export const ONTARIO_LIF_MAX_FACTOR: Record<number, number> = {
  41: 0.0598531, 42: 0.0600600, 43: 0.0602808, 44: 0.0605167, 45: 0.0607687,
  46: 0.0610382, 47: 0.0613265, 48: 0.0616350, 49: 0.0619655, 50: 0.0623197,
  51: 0.0626996, 52: 0.0631073, 53: 0.0635454, 54: 0.0640164, 55: 0.0645234,
  56: 0.0650697, 57: 0.0656589, 58: 0.0662952, 59: 0.0669833, 60: 0.0677285,
  61: 0.0685367, 62: 0.0694147, 63: 0.0703703, 64: 0.0714124, 65: 0.0725513,
  66: 0.0737988, 67: 0.0751689, 68: 0.0766778, 69: 0.0783449, 70: 0.0801930,
  71: 0.0822496, 72: 0.0845480, 73: 0.0871288, 74: 0.0900423, 75: 0.0933511,
  76: 0.0971347, 77: 0.1014952, 78: 0.1065661, 79: 0.1125255, 80: 0.1196160,
  81: 0.1281773, 82: 0.1387002, 83: 0.1519207, 84: 0.1689953, 85: 0.1918515,
  86: 0.2239589, 87: 0.2722561, 88: 0.3529338, 89: 0.5145631, 90: 1.0,
};
/** Factor by AGE ATTAINED during the fiscal year (FSRA table keying). */
export const ontarioLifMaxFactor = (ageAttained: number): number =>
  ageAttained >= 90 ? 1.0 : ageAttained <= 41 ? ONTARIO_LIF_MAX_FACTOR[41] : ONTARIO_LIF_MAX_FACTOR[ageAttained];

// ---------------------------------------------------------------------------
// 7. VALIDATION ANCHORS — assert these in Gate 1 unit tests
// ---------------------------------------------------------------------------

/**
 * Top combined federal+Ontario marginal rates (income above $258,482, where
 * the ON surtax fully applies). [KPMG-26]/[EY-ON26]/PwC all agree:
 *   regular income 53.53% · capital gains 26.76% · eligible dividends 39.34%
 * Additional anchors: federal age credit max $1,289 vanishing at $107,819 net
 * income; Ontario age credit max $320 vanishing at $89,490; Ontario tax fully
 * reduced up to $18,930 taxable income, clawback zone ending $24,870 [EY-ON26].
 */
export const VALIDATION_ANCHORS = {
  topCombinedMarginalRegular: 0.5353,
  topCombinedMarginalCapitalGains: 0.2676,
  topCombinedMarginalEligibleDividend: 0.3934,
  fedAgeCreditMax: 1_289, fedAgeCreditNilAtNetIncome: 107_819,
  onAgeCreditMax: 320,    onAgeCreditNilAtNetIncome: 89_490,
  onTaxReductionZeroTaxUpTo: 18_930, onTaxReductionClawbackEnd: 24_870,
} as const;

// ---------------------------------------------------------------------------
// 8. ECONOMIC DEFAULTS (user-editable in UI; not policy — no source pinning)
// ---------------------------------------------------------------------------

export const ECON_DEFAULTS = {
  inflation: 0.021,                       // Bank of Canada target band midpoint-ish
  inflationAR1: { target: 0.021, phi: 0.5, sigma: 0.010, min: -0.02, max: 0.10 },
  salaryRealGrowth: 0.01,
  marketCorrelation: 0.85,                // shared-factor rho, design §9.1
  horizonAgeYoungerSpouse: 95,
  mcTrials: 2_000,
} as const;

/** C6 — surface policy vintage in the UI footer. */
export const POLICY_BASELINE = {
  /** Tax year of bracket / limit bases in this file. */
  taxYear: 2026,
  /** ISO date constants were last retrieved (see file header). */
  retrievedOn: RETRIEVED,
  jurisdiction: "Federal + Ontario",
} as const;
