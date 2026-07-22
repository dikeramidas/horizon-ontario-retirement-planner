/**
 * Proves the public engine surface used by the UI returns real planning outcomes
 * for the sample household defaults shipped in the app.
 */
import { describe, it, expect } from "vitest";
import { simulate, runMonteCarlo, tuneStrategy } from "../engine-entry";
import { sampleHousehold } from "./sampleHousehold";
import { cashflowSeries } from "./cashflow";

describe("UI → engine entry path", () => {
  it("deterministic simulate yields funded path, tax, estate, account withdrawals", () => {
    const input = sampleHousehold();
    const res = simulate({ ...input, solverQuality: "thorough" });
    expect(res.rows.length).toBeGreaterThan(20);
    expect(res.lifetimeTax).toBeGreaterThan(0);
    expect(res.afterTaxEstateReal).toBeGreaterThan(0);
    expect(res.failedAnyYear).toBe(false);
    const cf = cashflowSeries(res, true);
    const sumReg = cf.reduce((s, r) => s + r.registered + r.topUp, 0);
    expect(sumReg).toBeGreaterThan(0);
  });

  it("tuneStrategy returns naive vs tuned comparison fields", () => {
    const res = tuneStrategy(sampleHousehold(), { maxCeiling: 100_000, coarseStep: 25_000, fineStep: 25_000 });
    expect(res.bestCeilingToday).toBeGreaterThanOrEqual(0);
    expect(res.tuned.lifetimeTax).toBeGreaterThan(0);
    expect(res.naive.lifetimeTax).toBeGreaterThan(0);
    expect(typeof res.totalTaxSaving).toBe("number");
    expect(typeof res.estateRealGain).toBe("number");
  });

  it("runMonteCarlo returns success rate and percentile fan", () => {
    const res = runMonteCarlo(sampleHousehold(), {
      trials: 8,
      seed: 7,
      defaultVol: 0.08,
      inflation: { kind: "fixed" },
    });
    expect(res.trials).toBe(8);
    expect(res.successRate).toBeGreaterThanOrEqual(0);
    expect(res.successRate).toBeLessThanOrEqual(1);
    expect(res.netWorthRealPercentiles.p50.length).toBe(res.years);
    expect(res.estateReal.p50).toBeGreaterThan(0);
    expect(res.lifetimeTax.mean).toBeGreaterThan(0);
  });
});
