/**
 * Gate 1 test suite (design §14.1–14.2 anchors that live in the tax engine).
 * Every numeric assertion is either (a) an external figure pinned at Gate 0
 * (see VALIDATION_ANCHORS in constants-2026.ts) or (b) hand-computed
 * arithmetic shown line-by-line in comments. No "it ran" tests.
 */
import { describe, it, expect } from "vitest";
import {
  computeTax, optimizeHouseholdTax, marginalRate,
  ontarioHealthPremium, federalBpa, bracketTax,
  type PersonIncome,
} from "../src/tax";
import { FEDERAL, ONTARIO, VALIDATION_ANCHORS as A } from "../src/constants-2026";

const worker = (extra: Partial<PersonIncome> = {}): PersonIncome =>
  ({ ageDec31: 40, ...extra });
const senior = (extra: Partial<PersonIncome> = {}): PersonIncome =>
  ({ ageDec31: 70, ...extra });

// ---------------------------------------------------------------------------
// External anchor #1 — top combined marginal rates (KPMG/EY/PwC, 2026)
// Income above $258,482; non-senior, no OAS, so no phase-outs move.
// ---------------------------------------------------------------------------
describe("top combined marginal rates (external anchors)", () => {
  const base = worker({ employment: 400_000 });

  it("regular income: 53.53% (= 33% + 13.16% × 1.56 surtax factor)", () => {
    expect(marginalRate(base, "employment", 1000)).toBeCloseTo(0.535296, 6);
    expect(Math.round(marginalRate(base, "employment", 1000) * 10000) / 10000).toBe(A.topCombinedMarginalRegular);
  });

  it("capital gains: 26.76% (half of regular at 50% inclusion)", () => {
    const m = marginalRate(base, "realizedCapitalGains", 1000);
    expect(m).toBeCloseTo(0.535296 / 2, 6);
    expect(Math.round(m * 10000) / 10000).toBeCloseTo(A.topCombinedMarginalCapitalGains, 3);
  });

  it("eligible dividends: 39.34% — validates surtax-BEFORE-DTC ordering", () => {
    // 1.38×(33% − 15.0198%)  federal            = 0.24812676
    // 1.38×13.16%×1.56       ON tax w/ surtax   = 0.28330848
    // −1.38×10%              ON DTC (unsurtaxed)= −0.138
    // total                                     = 0.39343524
    const m = marginalRate(base, "eligibleDividends", 1000);
    expect(m).toBeCloseTo(0.393435, 5);
    expect(Math.round(m * 10000) / 10000).toBe(A.topCombinedMarginalEligibleDividend);
  });
});

// ---------------------------------------------------------------------------
// External anchor #2 — age credits: maxima and vanishing incomes (EY 2026)
// ---------------------------------------------------------------------------
describe("age amount phase-outs (external anchors)", () => {
  it("federal: max credit $1,289; amount nil at $107,819 net income", () => {
    expect(FEDERAL.ageAmount.value * FEDERAL.creditRate.value).toBeCloseTo(A.fedAgeCreditMax, 0); // 9,208×14% = 1,289.12
    const low = computeTax(senior({ rrifLifIncome: 46_432 }));
    expect(low.breakdown.federalPersonalCredits).toBeCloseTo(16_452 + 9_208 + 2_000, 2);
    const nil = computeTax(senior({ rrifLifIncome: A.fedAgeCreditNilAtNetIncome }));
    // age component = 9,208 − 0.15 × (107,819 − 46,432) = 9,208 − 9,208.05 → 0
    expect(nil.breakdown.federalPersonalCredits).toBeCloseTo(16_452 + 0 + 2_000, 1);
  });

  it("Ontario: max credit $320; amount nil at $89,490 net income", () => {
    expect(ONTARIO.ageAmount.value * ONTARIO.creditRate.value).toBeCloseTo(A.onAgeCreditMax, 0); // 6,342×5.05% = 320.27
    const nil = computeTax(senior({ rrifLifIncome: A.onAgeCreditNilAtNetIncome }));
    // 6,342 − 0.15 × (89,490 − 47,210) = 6,342 − 6,342 = 0 exactly
    expect(nil.breakdown.ontarioPersonalCredits).toBeCloseTo(12_989 + 0 + 1_796, 6);
  });
});

// ---------------------------------------------------------------------------
// External anchor #3 — Ontario tax reduction zone (EY note 6, 2026)
// "No provincial income tax up to $18,930; clawback ends at $24,870."
// (Excludes the Health Premium, per EY's own note.)
// ---------------------------------------------------------------------------
describe("Ontario tax reduction (external anchors)", () => {
  const onIncomeTax = (ti: number) => {
    const r = computeTax(worker({ employment: ti }));
    return r.ontarioTax - r.breakdown.ontarioHealthPremium;
  };
  it("zero ON income tax at $18,930", () => {
    // basic = 5.05% × (18,930 − 12,989) = 300.02 ; reduction = 600 − 300.02 = 299.98 (capped) → ~0
    expect(onIncomeTax(A.onTaxReductionZeroTaxUpTo)).toBeLessThan(0.10);
  });
  it("reduction fully clawed back at $24,870 (ON tax = $600 = 2 × basic amount)", () => {
    // basic = 5.05% × (24,870 − 12,989) = 600.0 ; reduction = 600 − 600 = 0
    expect(onIncomeTax(A.onTaxReductionClawbackEnd)).toBeCloseTo(600, 0);
  });
  it("marginal ON rate doubles to 10.1% inside the clawback zone", () => {
    const r = computeTax(worker({ employment: 21_000 }));
    const r2 = computeTax(worker({ employment: 21_100 }));
    const onMarg = ((r2.ontarioTax - r2.breakdown.ontarioHealthPremium) -
                    (r.ontarioTax - r.breakdown.ontarioHealthPremium)) / 100;
    expect(onMarg).toBeCloseTo(0.101, 3);
  });
});

// ---------------------------------------------------------------------------
// External anchor #4 — BPA enhancement worth $227, phased out 181,440→258,482
// ---------------------------------------------------------------------------
describe("federal BPA phase-out (external anchor)", () => {
  it("$16,452 max / $14,829 base; enhancement credit ≈ $227", () => {
    expect(federalBpa(100_000)).toBe(16_452);
    expect(federalBpa(300_000)).toBe(14_829);
    expect(federalBpa((181_440 + 258_482) / 2)).toBeCloseTo(16_452 - 1_623 / 2, 6);
    expect(1_623 * FEDERAL.creditRate.value).toBeCloseTo(227, 0);
  });
});

// ---------------------------------------------------------------------------
// External anchor #5 — Ontario Health Premium band table [T4032ON / EY]
// ---------------------------------------------------------------------------
describe("Ontario Health Premium (frozen band table)", () => {
  const cases: Array<[number, number]> = [
    [15_000, 0], [20_000, 0],
    [25_000, 300], [36_000, 300],
    [38_500, 450], [48_000, 450],
    [48_600, 600], [72_000, 600],
    [72_600, 750], [200_000, 750],
    [200_600, 900], [500_000, 900],
  ];
  for (const [ti, expected] of cases) {
    it(`OHP(${ti.toLocaleString()}) = $${expected}`, () =>
      expect(ontarioHealthPremium(ti)).toBeCloseTo(expected, 6));
  }
});

// ---------------------------------------------------------------------------
// Hand-computed full profiles (arithmetic in comments, asserted to the cent)
// ---------------------------------------------------------------------------
describe("hand-computed full profiles", () => {
  it("worker, $45,000 employment → total tax $6,063.28", () => {
    // Federal: 14% × 45,000 = 6,300.00 ; BPA credit 16,452 × 14% = 2,303.28
    //          federal = 3,996.72
    // Ontario: 5.05% × 45,000 = 2,272.50 ; BPA credit 12,989 × 5.05% = 655.9445
    //          basic = 1,616.5555 ; surtax 0 ; reduction 0 (basic > 600)
    //          OHP(45,000) = min(450, 300 + 6% × 9,000) = 450
    //          ontario = 2,066.5555
    // Total = 6,063.2755
    const r = computeTax(worker({ employment: 45_000 }));
    expect(r.federalTax).toBeCloseTo(3_996.72, 2);
    expect(r.ontarioTax).toBeCloseTo(2_066.56, 2);
    expect(r.totalTax).toBeCloseTo(6_063.28, 2);
  });

  it("senior 70: RRIF $30k + CPP $12k + OAS $9,024 → total tax $5,506.08", () => {
    // Net income = 51,024 (< 95,323 → no clawback)
    // Federal before credits: 14% × 51,024 = 7,143.36
    //   credits: BPA 16,452 + age (9,208 − 0.15×4,592 = 8,519.20) + pension 2,000
    //          = 26,971.20 × 14% = 3,775.968 → federal = 3,367.392
    // Ontario before credits: 5.05% × 51,024 = 2,576.712
    //   credits: BPA 12,989 + age (6,342 − 0.15×3,814 = 5,769.90) + pension 1,796
    //          = 20,554.90 × 5.05% = 1,038.02245 → basic = 1,538.68955
    //   surtax 0 ; reduction 0 ; OHP(51,024) = min(600, 450 + 0.25×3,024) = 600
    //   ontario = 2,138.68955
    // Total = 5,506.08
    const r = computeTax(senior({ rrifLifIncome: 30_000, cpp: 12_000, oas: 9_024 }));
    expect(r.oasClawback).toBe(0);
    expect(r.federalTax).toBeCloseTo(3_367.39, 2);
    expect(r.ontarioTax).toBeCloseTo(2_138.69, 2);
    expect(r.totalTax).toBeCloseTo(5_506.08, 2);
  });

  it("dividends-only retiree (55, $60k eligible): pays ONLY the $750 OHP", () => {
    // TI = 60,000 × 1.38 = 82,800
    // Federal: 13,170.005 − BPA 2,303.28 − DTC (15.0198% × 82,800 = 12,436.39) < 0 → 0
    // Ontario: basic 4,710.72 ; surtax 0 ; DTC 8,280 → 0 ; OHP(82,800) = 750
    const r = computeTax({ ageDec31: 55, eligibleDividends: 60_000 });
    expect(r.federalTax).toBe(0);
    expect(r.ontarioTax).toBeCloseTo(750, 2);
    expect(r.totalTax).toBeCloseTo(750, 2);
  });
});

// ---------------------------------------------------------------------------
// OAS recovery tax mechanics (threshold $95,323, 15%, capped; deducted from
// income AND payable — marginal in zone = 0.85 × t + 0.15)
// ---------------------------------------------------------------------------
describe("OAS clawback", () => {
  const oas = 9_024;
  it("zero at the threshold; $1,500 at $10k over; capped at OAS received", () => {
    const at = computeTax(senior({ oas, rrifLifIncome: 95_323 - oas }));
    expect(at.oasClawback).toBeCloseTo(0, 6);
    const over = computeTax(senior({ oas, rrifLifIncome: 95_323 - oas + 10_000 }));
    expect(over.oasClawback).toBeCloseTo(1_500, 2);
    const far = computeTax(senior({ oas, rrifLifIncome: 300_000 }));
    expect(far.oasClawback).toBe(oas);
  });

  it("marginal effective rate in the zone = 0.85 × t + 0.15 (t = 26% + 17.4096% ON)", () => {
    // Pick net income before adjustments ≈ 130k: fed 26% bracket, ON 11.16% × 1.56.
    const p = senior({ oas, rrifLifIncome: 130_000 - oas });
    const m = marginalRate(p, "rrifLifIncome", 100);
    const t = 0.26 + 0.1116 * 1.56;                    // 0.434096 (age credits already nil here)
    expect(m).toBeCloseTo(0.85 * t + 0.15, 4);         // = 0.518982
  });
});

// ---------------------------------------------------------------------------
// Surtax kinks (derived from [T4032ON] thresholds; single filer, BPA only)
// ---------------------------------------------------------------------------
describe("Ontario surtax kinks", () => {
  it("basic ON tax crosses $5,818 near TI $94,901 → ON marginal 9.15% → 10.98%", () => {
    const below = marginalRate(worker({ employment: 90_000 }), "employment");
    const above = marginalRate(worker({ employment: 100_000 }), "employment");
    expect(below).toBeCloseTo(0.205 + 0.0915, 4);            // 29.65%
    expect(above).toBeCloseTo(0.205 + 0.0915 * 1.2, 4);      // 31.48%
  });
  it("both tiers active at TI $130k → combined 26% + 11.16%×1.56 = 43.41%", () => {
    expect(marginalRate(worker({ employment: 130_000 }), "employment"))
      .toBeCloseTo(0.26 + 0.1116 * 1.56, 4);
  });
});

// ---------------------------------------------------------------------------
// Pension credit eligibility rules (ITA: DB any age, RRIF/LIF only at 65+)
// ---------------------------------------------------------------------------
describe("pension income credit eligibility", () => {
  it("RRIF income at 64: NOT eligible; at 65: eligible", () => {
    const at64 = computeTax({ ageDec31: 64, rrifLifIncome: 50_000 });
    const at65 = computeTax({ ageDec31: 65, rrifLifIncome: 50_000 });
    expect(at64.breakdown.eligiblePensionIncomeForCredit).toBe(0);
    expect(at65.breakdown.eligiblePensionIncomeForCredit).toBe(50_000);
  });
  it("DB pension at 58: eligible (credit amount capped at $2,000/$1,796)", () => {
    const r = computeTax({ ageDec31: 58, dbPension: 40_000 });
    expect(r.breakdown.eligiblePensionIncomeForCredit).toBe(40_000);
    expect(r.breakdown.federalPersonalCredits).toBeCloseTo(16_452 + 2_000, 2);
    expect(r.breakdown.ontarioPersonalCredits).toBeCloseTo(12_989 + 1_796, 2);
  });
});

// ---------------------------------------------------------------------------
// Pension income splitting optimizer (design §7.3)
// ---------------------------------------------------------------------------
describe("pension splitting optimizer", () => {
  it("high-RRIF spouse → transfers a large share to low-income spouse; big saving", () => {
    const a = senior({ rrifLifIncome: 90_000, cpp: 10_000, oas: 9_024 });
    const b = senior({ cpp: 5_000, oas: 9_024 });
    const unsplit = computeTax(a).totalTax + computeTax(b).totalTax;
    const best = optimizeHouseholdTax(a, b);
    expect(best.splitDirection).toBe("AtoB");
    expect(best.splitFraction).toBeGreaterThan(0.30);
    expect(unsplit - best.totalTax).toBeGreaterThan(1_000);
    // Transferee gains pension-credit eligibility on the split RRIF income (65+):
    expect(best.b.breakdown.eligiblePensionIncomeForCredit).toBeGreaterThanOrEqual(2_000);
  });

  it("identical spouses on a flat region (net $57,024): no benefit, no split", () => {
    // All slopes cancel and every deviation crosses a costly kink first
    // (transferee hits the 20.5% federal bracket at t = $1,499); verified by
    // component decomposition — optimum is exactly zero.
    const p = senior({ rrifLifIncome: 40_000, cpp: 8_000, oas: 9_024 });
    const unsplit = 2 * computeTax(p).totalTax;
    const best = optimizeHouseholdTax(p, { ...p });
    expect(best.splitDirection).toBe("none");
    expect(best.totalTax).toBeCloseTo(unsplit, 2);
  });

  it("identical spouses at net $77,024: REAL ~$194 saving (OHP plateau + ON age-credit asymmetry)", () => {
    // Component decomposition (tests/_debug run, 2026-07-19):
    //   t = 5,024: household OHP 1,500 → 1,350 (A drops below the $72,000 band; B stays capped)  = $150
    //   t = 12,466→18,300: ON income tax falls $44 — B's ON age amount is already NIL
    //     (net > $89,490) so B stops losing credit while A regains at 15% × 5.05%;
    //     the federal age amounts (nil only at $107,819) still cancel.
    //   t > ~18,300: B's net income before adjustments crosses $95,323 → OAS clawback → optimum stops.
    const p = senior({ rrifLifIncome: 60_000, cpp: 8_000, oas: 9_024 });
    const unsplit = 2 * computeTax(p).totalTax;
    const best = optimizeHouseholdTax(p, { ...p });
    expect(unsplit - best.totalTax).toBeGreaterThan(185);
    expect(unsplit - best.totalTax).toBeLessThan(200);
    const ohpSum = best.a.breakdown.ontarioHealthPremium + best.b.breakdown.ontarioHealthPremium;
    expect(ohpSum).toBeCloseTo(1_350, 2);                       // −$150 vs unsplit 2 × 750
    expect(best.splitAmount).toBeGreaterThan(17_000);           // just below the clawback wall
    expect(best.splitAmount).toBeLessThan(18_310);
    expect(best.b.oasClawback).toBeLessThan(5);                 // optimum avoids triggering it
  });

  it("splitting can rescue OAS from clawback (transferor net income drops)", () => {
    const a = senior({ rrifLifIncome: 110_000, oas: 9_024 });
    const b = senior({ oas: 9_024 });
    const before = computeTax(a);
    expect(before.oasClawback).toBeGreaterThan(2_000);
    const best = optimizeHouseholdTax(a, b);
    expect(best.a.oasClawback).toBeLessThan(before.oasClawback - 1_500);
  });
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------
describe("structural invariants", () => {
  it("bracketTax is continuous and monotone across all boundaries", () => {
    for (const brk of [FEDERAL.brackets.value, ONTARIO.brackets.value]) {
      for (const b of brk) {
        if (b.from === 0) continue;
        expect(bracketTax(b.from + 0.01, brk) - bracketTax(b.from - 0.01, brk))
          .toBeLessThan(0.02 * 0.35);
      }
      let prev = 0;
      for (let x = 0; x <= 400_000; x += 1_000) {
        const t = bracketTax(x, brk);
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    }
  });

  it("total tax is monotone in employment income (incl. OHP/reduction/surtax kinks)", () => {
    let prev = -1;
    for (let inc = 0; inc <= 300_000; inc += 500) {
      const t = computeTax(worker({ employment: inc })).totalTax;
      expect(t).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = t;
    }
  });

  it("RRSP deduction reduces tax at the marginal rate (kink-free span)", () => {
    // 130k→120k crosses no kink: fed 26% bracket spans 117,045–181,440;
    // Ontario basic tax is above BOTH surtax tiers at each end (8,360 and
    // 9,476 vs 7,446), so ON marginal = 11.16% × 1.56; OHP capped at $750 both.
    const noDed = computeTax(worker({ employment: 130_000 }));
    const ded = computeTax(worker({ employment: 130_000, rrspDeduction: 10_000 }));
    expect(noDed.totalTax - ded.totalTax).toBeCloseTo(10_000 * (0.26 + 0.1116 * 1.56), 0); // 4,340.96
  });
});
