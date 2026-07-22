import { describe, it, expect } from "vitest";
import { sampleHousehold } from "../src/lib/sampleHousehold";
import { simulate } from "../src/simulate";
import { nominalSpendTarget } from "../src/lib/spendPlan";
import { runSensitivityTornado } from "../src/lib/sensitivity";
import { housingValueNominal } from "../src/lib/housing";

describe("P2 modules (engine path)", () => {
  it("spend phases + one-time goals raise nominal target", () => {
    const h = sampleHousehold();
    h.spendPhases = [
      { fromAgeYounger: 0, spendToday: 80_000 },
      { fromAgeYounger: 75, spendToday: 60_000 },
    ];
    h.oneTimeGoals = [{ year: 2030, amountToday: 25_000, label: "Reno" }];
    const youngAt2030 = 2030 - Math.max(h.persons[0].birthYear, h.persons[1].birthYear);
    // younger is 1978 → age in 2030 = 52 → still first phase 80k + 25k
    const t = nominalSpendTarget(h, 2030, 1, youngAt2030);
    expect(t).toBe(105_000);
  });

  it("housing adds tax-free estate when included", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    h.housing = {
      enabled: true,
      valueToday: 500_000,
      realGrowth: 0,
      includeInEstate: true,
    };
    const withH = simulate({ ...h, solverQuality: "thorough" });
    const without = simulate({
      ...h,
      housing: undefined,
      solverQuality: "thorough",
    });
    expect(withH.housingEstateReal ?? 0).toBeGreaterThan(100_000);
    expect(withH.afterTaxEstateReal).toBeGreaterThan(without.afterTaxEstateReal + 100_000);
  });

  it("payroll reduces after-tax cash vs no payroll on working path year", () => {
    const h = sampleHousehold();
    h.yearsOverride = 3;
    h.payroll = { enabled: true };
    const withP = simulate({ ...h, solverQuality: "thorough" });
    const noP = simulate({ ...h, payroll: undefined, solverQuality: "thorough" });
    const y0w = withP.rows[0].persons[0].payrollDeduction + withP.rows[0].persons[1].payrollDeduction;
    expect(y0w).toBeGreaterThan(0);
    const y0n =
      noP.rows[0].persons[0].payrollDeduction + noP.rows[0].persons[1].payrollDeduction;
    expect(y0n).toBe(0);
  });

  it("sensitivity tornado returns bars with real analyzePlan deltas", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    h.spendingTargetToday = 85_000;
    const s = runSensitivityTornado(h, { quick: true });
    expect(s.bars.length).toBeGreaterThanOrEqual(3);
    expect(s.bars.some((b) => b.id === "spend")).toBe(true);
    // At least one lever should move estate
    expect(s.bars.some((b) => Math.abs(b.downDelta) > 100 || Math.abs(b.upDelta) > 100)).toBe(
      true
    );
  }, 120_000);

  it("housingValueNominal compounds real growth with CPI", () => {
    const v = housingValueNominal(
      { enabled: true, valueToday: 100_000, realGrowth: 0.02 },
      10,
      1.2
    );
    expect(v).toBeCloseTo(100_000 * 1.2 * Math.pow(1.02, 10), 4);
  });
});
