/**
 * Gate 2 test suite — deterministic simulator (design §14.2–§14.4).
 * The three-year household in the last block is fully hand-computed in
 * comments (zero inflation, zero returns, so every figure is exact arithmetic
 * over the 2026 tax engine already proven at Gate 1).
 */
import { describe, it, expect } from "vitest";
import { simulate, type HouseholdInput, type PersonInput } from "../src/simulate";

const START = 2026;
const noBenefits = {};
const person = (over: Partial<PersonInput>): PersonInput => ({
  name: "p", birthYear: START - 70, retirementAge: 65, ...over,
});
const zeroReturns = { rrsp: 0, lira: 0, dcPension: 0, tfsa: 0, unregistered: 0 };

// ---------------------------------------------------------------------------
// §14.2 — Schedule tests
// ---------------------------------------------------------------------------

describe("RRIF minimums & younger-spouse election", () => {
  const base: HouseholdInput = {
    startYear: START, inflation: 0, yearsOverride: 1, spendingTargetToday: 1_000,
    persons: [
      person({ birthYear: START - 72, balances: { rrsp: 100_000 }, returns: zeroReturns }),
      person({ birthYear: START - 66, returns: zeroReturns }),
    ],
  };
  it("with the election (default): factor uses the YOUNGER spouse's Jan-1 age 65 → 4.00%", () => {
    // min = 1/(90−65) × 100,000 = 4,000.00
    const r = simulate(base);
    expect(r.rows[0].persons[0].rrifMin).toBeCloseTo(4_000, 2);
  });
  it("without the election: own Jan-1 age 71 → 5.28%", () => {
    const r = simulate({
      ...base,
      persons: [{ ...base.persons[0], rrifUseYoungerSpouseAge: false }, base.persons[1]],
    });
    expect(r.rows[0].persons[0].rrifMin).toBeCloseTo(5_280, 2);
  });
  it("no minimum in the conversion year itself (retiring at 65 this year)", () => {
    const r = simulate({
      ...base,
      persons: [
        person({ birthYear: START - 65, balances: { rrsp: 100_000 }, returns: zeroReturns }),
        person({ birthYear: START - 65, returns: zeroReturns }),
      ],
    });
    expect(r.rows[0].persons[0].rrifMin).toBe(0);
  });
});

describe("Ontario LIF: minimum, maximum cap, and the prior-year-return rule", () => {
  it("LIF max binds: withdrawal capped at 8.45% (age-71 factor), TFSA covers the rest", () => {
    // Both 72 (Jan-1 age 71). LIRA 200,000 → LIF at 65 (unlock OFF).
    // min = 5.28% × 200,000 = 10,560 (RRIF factor, Jan-1 age)
    // max = 8.45480% × 200,000 = 16,909.60 (FSRA factor, age ATTAINED 72)
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 1, spendingTargetToday: 100_000,
      persons: [
        person({ birthYear: START - 72, balances: { lira: 200_000, tfsa: 500_000 }, lifUnlock50: false, returns: zeroReturns }),
        person({ birthYear: START - 72, returns: zeroReturns }),
      ],
    });
    const p = r.rows[0].persons[0];
    expect(p.lifMin).toBeCloseTo(10_560, 2);
    expect(p.lifMax).toBeCloseTo(16_909.60, 2);
    expect(p.withdrawals.lif).toBeCloseTo(16_909.60, 1); // capped: min + all headroom
    expect(p.withdrawals.tfsa).toBeGreaterThan(60_000); // remainder funded tax-free
    expect(Math.abs(r.rows[0].spendingAchieved - 100_000)).toBeLessThanOrEqual(1);
  });

  it("next-year max = prior-year investment RETURN when it exceeds the factor", () => {
    // 10% LIF growth. Year 1: open 200,000, withdraw the max 16,909.60 (mid-year).
    //   end = 200,000×1.10 − 16,909.60×1.05 = 220,000 − 17,755.08 = 202,244.92
    //   growth$ = end − open + withdrawals = 202,244.92 − 200,000 + 16,909.60 = 19,154.52
    // Year 2 factor max = 8.71288% × 202,244.92 = 17,621.19 < 19,154.52 → growth binds.
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 2, spendingTargetToday: 100_000,
      persons: [
        person({ birthYear: START - 72, balances: { lira: 200_000, tfsa: 500_000 }, lifUnlock50: false, returns: { ...zeroReturns, lira: 0.10 } }),
        person({ birthYear: START - 72, returns: zeroReturns }),
      ],
    });
    expect(r.rows[1].persons[0].lifMax).toBeCloseTo(19_154.52, 1);
  });

  it("Ontario 50% unlock moves half the locked balance to the RRIF at conversion", () => {
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 1, spendingTargetToday: 1_000,
      persons: [
        person({ birthYear: START - 72, balances: { lira: 200_000 }, lifUnlock50: true, returns: zeroReturns }),
        person({ birthYear: START - 72, returns: zeroReturns }),
      ],
    });
    const p = r.rows[0].persons[0];
    // RRIF minimum on the unlocked 100,000 at Jan-1 age 71 → 5.28% = 5,280;
    // LIF minimum on the remaining 100,000 → 5,280 as well.
    expect(p.rrifMin).toBeCloseTo(5_280, 2);
    expect(p.lifMin).toBeCloseTo(5_280, 2);
  });
});

describe("TFSA room restoration (withdrawals restore room the following Jan 1)", () => {
  it("year-2 room = leftover + annual limit + year-1 withdrawals", () => {
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 2, spendingTargetToday: 40_000,
      persons: [
        person({ tfsaRoomNow: 5_000, balances: { tfsa: 200_000 }, returns: zeroReturns }),
        person({ returns: zeroReturns }),
      ],
    });
    const w1 = r.rows[0].persons[0].withdrawals.tfsa;
    expect(w1).toBeCloseTo(40_000, 0); // tax-free spending, solver exact
    // rooms: 5,000 (− tiny surplus routed) + 7,000 annual + 40,000 restored (− tiny surplus)
    expect(r.rows[1].persons[0].roomsEnd.tfsa).toBeCloseTo(52_000, 0);
  });
});

describe("RRSP room accrual with Pension Adjustments (design §6 step 2)", () => {
  it("DC pension: next-year room = min(18% × salary, limit) − DC contributions", () => {
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 2, spendingTargetToday: 0,
      persons: [
        person({
          birthYear: START - 40, retirementAge: 65, salaryToday: 100_000, salaryRealGrowth: 0,
          rrspRoomNow: 15_000, savings: { rrsp: { type: "fixed", amount: 30_000 }, dc: { type: "fixed", amount: 8_000 } },
          returns: zeroReturns, reinvestRrspRefund: false,
        }),
        person({ birthYear: START - 40, retirementAge: 65, returns: zeroReturns }),
      ],
    });
    const y1 = r.rows[0].persons[0], y2 = r.rows[1].persons[0];
    expect(y1.contributions.rrsp).toBe(15_000);          // capped by current room
    expect(y1.contributions.unregistered).toBe(15_000);  // overflow (no TFSA room)
    expect(y1.contributions.dc).toBe(8_000);
    // Year 2 new room = min(18,000, 33,810) − PA 8,000 = 10,000
    expect(y2.contributions.rrsp).toBe(10_000);
    expect(y2.roomsEnd.rrsp).toBe(0);
  });

  it("DB accrual: PA = 9 × accrual − 600 → new room = 18,000 − 10,200 = 7,800", () => {
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 2, spendingTargetToday: 0,
      persons: [
        person({
          birthYear: START - 40, retirementAge: 65, salaryToday: 100_000,
          rrspRoomNow: 0, savings: { rrsp: { type: "fixed", amount: 30_000 } },
          db: { currentAnnualEntitlementToday: 5_000, accrualPerYearToday: 1_200 },
          returns: zeroReturns, reinvestRrspRefund: false,
        }),
        person({ birthYear: START - 40, retirementAge: 65, returns: zeroReturns }),
      ],
    });
    expect(r.rows[1].persons[0].contributions.rrsp).toBe(7_800);
  });

  it("prior-year RRSP refund lands next year at the exact tax value of the deduction", () => {
    // Salary 100,000, deduction 10,000 → Gate 1 established the exact value of
    // this deduction (the span crosses the surtax entry): $3,058.30.
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 2, spendingTargetToday: 0,
      persons: [
        person({
          birthYear: START - 40, retirementAge: 65, salaryToday: 100_000,
          rrspRoomNow: 50_000, savings: { rrsp: { type: "fixed", amount: 10_000 } },
          returns: zeroReturns, reinvestRrspRefund: true,
        }),
        person({ birthYear: START - 40, retirementAge: 65, returns: zeroReturns }),
      ],
    });
    const y2 = r.rows[1].persons[0];
    expect(y2.refundReceived).toBeCloseTo(3_058.30, 1);
    // Year-2 room accrual adds the $7,000 TFSA annual limit, so the refund
    // routes to the TFSA (the design's TFSA-first chain), not unregistered.
    expect(y2.contributions.tfsa).toBeCloseTo(3_058.30, 1);
    expect(y2.contributions.unregistered).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §14.3 — Solver: convergence, conservation, failure
// ---------------------------------------------------------------------------

describe("solver convergence, conservation, failure", () => {
  it("a depleting household fails in the right year with the right shortfall", () => {
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 2, spendingTargetToday: 100_000,
      persons: [
        person({ balances: { tfsa: 10_000 }, returns: zeroReturns }),
        person({ returns: zeroReturns }),
      ],
    });
    expect(r.rows[0].failed).toBe(true);
    expect(r.failedAnyYear).toBe(true);
    expect(r.firstFailureYear).toBe(START);
    // Only 10,000 of tax-free cash exists → shortfall = 90,000
    expect(r.rows[0].shortfall).toBeCloseTo(90_000, 0);
    expect(r.rows[0].spendingAchieved).toBeCloseTo(10_000, 0);
  });

  it("estate: a TFSA-only household passes 100% tax-free", () => {
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 1, spendingTargetToday: 1_000,
      persons: [
        person({ balances: { tfsa: 300_000 }, returns: zeroReturns }),
        person({ returns: zeroReturns }),
      ],
    });
    expect(r.afterTaxEstate).toBeCloseTo(r.finalBalances.total, 2);
  });

  it("top-up ceiling melts the RRIF to the target taxable income; excess is saved", () => {
    const r = simulate({
      startYear: START, inflation: 0, yearsOverride: 1, spendingTargetToday: 30_000,
      strategy: { topUpCeilingToday: 60_000 },
      persons: [
        person({ balances: { rrsp: 500_000 }, cpp: { annualAt65Today: 12_000, startAge: 65 }, returns: zeroReturns }),
        person({ returns: zeroReturns }),
      ],
    });
    const p = r.rows[0].persons[0];
    expect(p.withdrawals.topUp).toBeGreaterThan(10_000);
    expect(p.taxableIncomePreSplit).toBeCloseTo(60_000, 0);
    expect(r.rows[0].surplusToTfsa + r.rows[0].surplusToUnregistered).toBeGreaterThan(10_000);
    expect(Math.abs(r.rows[0].conservationResidual)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §14.4 — The hand-computed three-year household (line-by-line)
// ---------------------------------------------------------------------------

describe("hand-computed 3-year household (zero inflation, zero returns)", () => {
  // A (70): RRIF 300,000 (converted at 65), CPP 12,000, OAS 9,023.64 (full).
  // B (70): TFSA 100,000; unregistered 50,000 with ACB 50,000 (sales tax-free).
  // Target: 60,000 after tax. Top-up ceiling 0. All returns 0, inflation 0.
  const input: HouseholdInput = {
    startYear: START, inflation: 0, yearsOverride: 3, spendingTargetToday: 60_000,
    persons: [
      person({
        name: "A", birthYear: START - 70,
        balances: { rrsp: 300_000 }, returns: zeroReturns,
        cpp: { annualAt65Today: 12_000, startAge: 65 },
        oas: { startAge: 65, residenceYears: 40 },
      }),
      person({
        name: "B", birthYear: START - 70, returns: zeroReturns,
        balances: { tfsa: 100_000, unregistered: { balance: 50_000, acb: 50_000 } },
      }),
    ],
  };
  const r = simulate(input);
  const [y1, y2, y3] = r.rows;

  it("year 1 — RRIF minimum: Jan-1 age 69 → 1/(90−69) × 300,000 = 14,285.71", () => {
    expect(y1.persons[0].rrifMin).toBeCloseTo(300_000 / 21, 2);
  });

  it("year 1 — pension split lands at exactly 50% (7,142.86 to B; B's tax stays 0)", () => {
    // A's tax is strictly decreasing in the split fraction on [0, 0.5]
    // (B remains under all credit floors throughout), so the optimum is 0.50.
    expect(y1.splitDirection).toBe("AtoB");
    expect(y1.splitAmount).toBeCloseTo(300_000 / 21 / 2, 0);
  });

  it("year 1 — household tax $481.90, all on A (hand arithmetic in comments)", () => {
    // A post-split net income = 35,309.354286 − 7,142.857143 = 28,166.497143
    // Federal: 0.14 × 28,166.497143 = 3,943.3096
    //   credits (16,452 + 9,208 + 2,000) × 0.14 = 3,872.40 → federal = 70.9096
    // Ontario: 0.0505 × 28,166.497143 = 1,422.408106
    //   credits (12,989 + 6,342 + 1,796) × 0.0505 = 1,066.9135 → basic = 355.494606
    //   reduction = 600 − 355.494606 = 244.505394 → income tax = 110.989212
    //   OHP(28,166.50) = min(300, 6% × 8,166.50) = 300 → Ontario = 410.989212
    // A total = 481.898812 ; B = 0.
    expect(y1.householdTax).toBeCloseTo(481.90, 1);
    expect(y1.persons[1].tax.total).toBeCloseTo(0, 2);
  });

  it("year 1 — spending gap funded from B's unregistered, tax-free: 25,172.54", () => {
    // 60,000 − (35,309.354286 − 481.898812) = 25,172.544526
    expect(y1.persons[1].withdrawals.unregistered).toBeCloseTo(25_172.54, 0);
    expect(y1.persons[1].withdrawals.tfsa).toBe(0);
    expect(Math.abs(y1.spendingAchieved - 60_000)).toBeLessThanOrEqual(1);
  });

  it("year 2 — same minimum by arithmetic accident: 285,714.29 / 20 = 14,285.71", () => {
    expect(y2.persons[0].rrifMin).toBeCloseTo(14_285.71, 1);
  });

  it("year 2 — unregistered depletes; a small taxable RRIF top-off (~$392) covers the rest", () => {
    // Available unregistered ≈ 24,827.5 (year-1 leftover); gap ≈ 345 after tax;
    // grossed up at the ~12% household marginal (half splits to B at 0%).
    expect(y2.persons[1].withdrawals.unregistered).toBeCloseTo(y1.persons[1].balancesEnd.unregistered, 0);
    const extra = y2.persons[0].withdrawals.registered - y2.persons[0].rrifMin;
    expect(extra).toBeGreaterThan(300);
    expect(extra).toBeLessThan(500);
    expect(y2.persons[1].balancesEnd.unregistered).toBeLessThan(5);
    expect(Math.abs(y2.spendingAchieved - 60_000)).toBeLessThanOrEqual(1);
  });

  it("year 3 — minimum = 5.28% of the year-3 opening RRIF; TFSA still untouched at 100,000", () => {
    const opening = y2.persons[0].balancesEnd.rrsp;
    expect(y3.persons[0].rrifMin).toBeCloseTo(0.0528 * opening, 1);
    expect(y3.persons[1].withdrawals.tfsa).toBe(0);
    expect(y3.persons[1].balancesEnd.tfsa).toBeCloseTo(100_000, 0);
    expect(Math.abs(y3.spendingAchieved - 60_000)).toBeLessThanOrEqual(1);
  });

  it("all three years — solver converges to $1 and conservation holds to $1", () => {
    for (const row of r.rows) {
      expect(row.failed).toBe(false);
      expect(Math.abs(row.spendingAchieved - row.spendingTarget)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.conservationResidual)).toBeLessThanOrEqual(1);
    }
  });
});
