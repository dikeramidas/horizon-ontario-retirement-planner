/**
 * policy.ts — Year-scaled tax/benefit parameters (design §9.2).
 *
 * The simulator indexes every parameter flagged `indexed: "cpi"` (and, as a
 * documented §17 simplification, `"wage"`) along the simulated CPI path from
 * the 2026 bases in constants-2026.ts. Parameters flagged `"frozen"` never
 * move — this is what produces genuine long-horizon bracket creep (Ontario
 * Health Premium bands, the $2,000 federal pension amount, the $150k/$220k
 * Ontario brackets).
 *
 * `buildYearPolicy(1)` reproduces 2026 exactly; the Gate 1 suite runs on it.
 */
import { FEDERAL, ONTARIO, LIMITS, CPP, OAS, type Bracket } from "./constants-2026";

export interface YearPolicy {
  cpiIndex: number; // cumulative CPI multiplier vs 2026 (1.0 = 2026)
  federal: {
    brackets: Bracket[];
    creditRate: number;
    bpa: { max: number; base: number; phaseOutStart: number; phaseOutEnd: number };
    ageAmount: number; ageAmountThreshold: number; ageAmountPhaseOutRate: number;
    pensionIncomeAmount: number;              // frozen
    dividendGrossUp: number; dividendDtc: number;
    capitalGainsInclusion: number;
    oasClawbackThreshold: number; oasClawbackRate: number;
  };
  ontario: {
    brackets: Bracket[];                      // only the two indexed thresholds move
    creditRate: number;
    surtaxT1: number; surtaxT2: number; surtaxR1: number; surtaxR2: number;
    healthPremiumBands: ReadonlyArray<{ over: number; cap: number; rate: number; base: number }>; // frozen
    bpa: number;
    ageAmount: number; ageAmountThreshold: number; ageAmountPhaseOutRate: number;
    pensionIncomeAmount: number;
    dividendDtc: number;
    taxReductionBasic: number;
  };
  limits: {
    rrspDollarLimit: number; rrspEarnedIncomeRate: number;
    moneyPurchaseLimit: number; tfsaAnnualLimit: number;
    paDbOffset: number;                       // the $600 in PA = 9×accrual − 600 (frozen)
  };
  benefits: {
    cppMaxAnnualAt65: number;
    cppEarlyFactorPerMonth: number; cppDeferralFactorPerMonth: number;
    oasAnnualAt65: number;                    // 65–74 rate, full residence
    oasAge75Boost: number; oasDeferralFactorPerMonth: number;
    oasFullResidenceYears: number;
  };
}

export function buildYearPolicy(cpiIndex: number): YearPolicy {
  const cpi = (x: number) => x * cpiIndex;
  return {
    cpiIndex,
    federal: {
      brackets: FEDERAL.brackets.value.map((b) => ({ from: cpi(b.from), rate: b.rate })),
      creditRate: FEDERAL.creditRate.value,
      bpa: {
        max: cpi(FEDERAL.bpa.max.value),
        base: cpi(FEDERAL.bpa.base.value),
        phaseOutStart: cpi(FEDERAL.bpa.phaseOutStart.value),
        phaseOutEnd: cpi(FEDERAL.bpa.phaseOutEnd.value),
      },
      ageAmount: cpi(FEDERAL.ageAmount.value),
      ageAmountThreshold: cpi(FEDERAL.ageAmountThreshold.value),
      ageAmountPhaseOutRate: FEDERAL.ageAmountPhaseOutRate.value,
      pensionIncomeAmount: FEDERAL.pensionIncomeAmount.value, // frozen
      dividendGrossUp: FEDERAL.eligibleDividend.grossUp.value,
      dividendDtc: FEDERAL.eligibleDividend.dtcOnGrossedUp.value,
      capitalGainsInclusion: FEDERAL.capitalGainsInclusion.value,
      oasClawbackThreshold: cpi(FEDERAL.oasClawback.threshold.value),
      oasClawbackRate: FEDERAL.oasClawback.rate.value,
    },
    ontario: {
      // Index ONLY the statutorily indexed thresholds; $150k / $220k are frozen.
      brackets: ONTARIO.brackets.value.map((b, i) =>
        ({ from: i === 1 || i === 2 ? cpi(b.from) : b.from, rate: b.rate })),
      creditRate: ONTARIO.creditRate.value,
      surtaxT1: cpi(ONTARIO.surtax.tier1Threshold.value),
      surtaxT2: cpi(ONTARIO.surtax.tier2Threshold.value),
      surtaxR1: ONTARIO.surtax.tier1Rate.value,
      surtaxR2: ONTARIO.surtax.tier2Rate.value,
      healthPremiumBands: ONTARIO.healthPremium.value, // frozen since 2004
      bpa: cpi(ONTARIO.bpa.value),
      ageAmount: cpi(ONTARIO.ageAmount.value),
      ageAmountThreshold: cpi(ONTARIO.ageAmountThreshold.value),
      ageAmountPhaseOutRate: ONTARIO.ageAmountPhaseOutRate.value,
      pensionIncomeAmount: cpi(ONTARIO.pensionIncomeAmount.value),
      dividendDtc: ONTARIO.eligibleDividendDtcOnGrossedUp.value,
      taxReductionBasic: cpi(ONTARIO.taxReductionBasic.value),
    },
    limits: {
      rrspDollarLimit: cpi(LIMITS.rrspDollarLimit.value),   // §17: wage-indexed in law, CPI here
      rrspEarnedIncomeRate: LIMITS.rrspEarnedIncomeRate.value,
      moneyPurchaseLimit: cpi(LIMITS.moneyPurchaseLimit.value),
      tfsaAnnualLimit: cpi(LIMITS.tfsaAnnualLimit.value),   // §17: smooth, no $500 rounding
      paDbOffset: 600,
    },
    benefits: {
      cppMaxAnnualAt65: cpi(CPP.maxMonthlyAt65.value * 12),
      cppEarlyFactorPerMonth: CPP.earlyFactorPerMonth.value,
      cppDeferralFactorPerMonth: CPP.deferralFactorPerMonth.value,
      oasAnnualAt65: cpi(OAS.maxMonthly65to74.value * 12),
      oasAge75Boost: OAS.age75Boost.value,
      oasDeferralFactorPerMonth: OAS.deferralFactorPerMonth.value,
      oasFullResidenceYears: OAS.fullResidenceYears.value,
    },
  };
}

/** The 2026 baseline policy (what the Gate 1 anchors assert against). */
export const POLICY_2026: YearPolicy = buildYearPolicy(1);
