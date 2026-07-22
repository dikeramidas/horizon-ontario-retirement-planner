import { describe, it, expect } from "vitest";
import { analyzePlan } from "./analysis";
import { sampleHousehold } from "./sampleHousehold";
import { buildYearPolicy } from "../policy";
import {
  buildStrategyWhy,
  buildBracketEstimates,
  placeInBrackets,
} from "./taxExplain";

describe("tax strategy explanation + brackets (live analysis)", () => {
  const input = sampleHousehold();
  const names: [string, string] = [input.persons[0].name, input.persons[1].name];
  const analysis = analyzePlan(input, { quick: true });

  it("strategy why exposes tuned vs naive tax/estate consistent with tuneStrategy", () => {
    const why = buildStrategyWhy(analysis.tune);
    expect(why.bestCeilingToday).toBe(analysis.bestCeilingToday);
    expect(why.tunedLifetimeTax).toBe(analysis.tune.tuned.lifetimeTax);
    expect(why.naiveLifetimeTax).toBe(analysis.tune.naive.lifetimeTax);
    expect(why.totalTaxSaving).toBeCloseTo(analysis.totalTaxSaving, 6);
    expect(why.estateRealGain).toBeCloseTo(analysis.estateRealGain, 6);
    expect(why.livingTaxDelta).toBeCloseTo(
      analysis.tune.naive.lifetimeTax - analysis.tune.tuned.lifetimeTax,
      6
    );
    expect(why.reasons.length).toBeGreaterThanOrEqual(3);
    expect(why.disclaimer.toLowerCase()).toMatch(/heuristic|not a proof|not a.*global/);
    // Sample couple should show a real tax-saving story
    expect(why.totalTaxSaving).not.toBe(0);
  });

  it("bracket estimates match engine taxable income and year policy bands", () => {
    const years = buildBracketEstimates(analysis.primary, names, { retirementOnly: true });
    expect(years.length).toBeGreaterThan(5);

    const byYear = new Map(analysis.primary.rows.map((r) => [r.year, r]));
    // Check at least two distinct retirement years, both persons
    const sampleYears = [years[0], years[Math.min(5, years.length - 1)], years[years.length - 1]];
    for (const y of sampleYears) {
      const row = byYear.get(y.year)!;
      expect(row).toBeTruthy();
      const policy = buildYearPolicy(row.cpiIndex);
      for (const i of [0, 1] as const) {
        const eng = row.persons[i];
        const est = y.persons[i];
        expect(est.name).toBe(names[i]);
        expect(est.taxableIncome).toBeCloseTo(eng.taxableIncomePreSplit, 6);
        expect(est.taxTotal).toBeCloseTo(eng.tax.total, 6);
        expect(est.oasClawback).toBeCloseTo(eng.tax.clawback, 6);

        const fed = placeInBrackets(eng.taxableIncomePreSplit, policy.federal.brackets);
        const on = placeInBrackets(eng.taxableIncomePreSplit, policy.ontario.brackets);
        expect(est.federal.rate).toBeCloseTo(fed.rate, 9);
        expect(est.federal.from).toBeCloseTo(fed.from, 4);
        expect(est.ontario.rate).toBeCloseTo(on.rate, 9);
        expect(est.ontario.from).toBeCloseTo(on.from, 4);
        // Indexed years should move CPI-linked federal thresholds vs 2026 base
        expect(est.federal.from).toBeGreaterThanOrEqual(0);
        expect(est.federal.label).toMatch(/%/);
      }
    }

    // CPI path should eventually scale indexed brackets above 2026 for long horizons
    const late = years[years.length - 1];
    const early = years[0];
    if (late.cpiIndex > early.cpiIndex + 0.05) {
      const pLate = buildYearPolicy(late.cpiIndex);
      const pEarly = buildYearPolicy(early.cpiIndex);
      // Federal second threshold is CPI-indexed
      expect(pLate.federal.brackets[1].from).toBeGreaterThan(pEarly.federal.brackets[1].from);
    }
  });

  it("placeInBrackets respects progressive bands", () => {
    const policy = buildYearPolicy(1);
    const low = placeInBrackets(40_000, policy.federal.brackets);
    expect(low.rate).toBe(0.14);
    const mid = placeInBrackets(100_000, policy.federal.brackets);
    expect(mid.rate).toBe(0.205);
    const top = placeInBrackets(400_000, policy.federal.brackets);
    expect(top.rate).toBe(0.33);
    expect(top.to).toBeNull();
  });
});
