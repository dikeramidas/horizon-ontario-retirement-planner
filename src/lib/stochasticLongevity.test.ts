import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { runStochasticLongevity } from "./stochasticLongevity";

describe("runStochasticLongevity", () => {
  it("is seed-reproducible and reports estate percentiles", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    h.strategy = { ...(h.strategy ?? {}), topUpCeilingToday: 40_000 };
    const a = runStochasticLongevity(h, { trials: 80, seed: 3, survivorSpendFrac: 0.7 });
    const b = runStochasticLongevity(h, { trials: 80, seed: 3, survivorSpendFrac: 0.7 });
    expect(a.successRate).toBe(b.successRate);
    expect(a.estateReal.p50).toBeCloseTo(b.estateReal.p50, 6);
    expect(a.estateReal.p10).toBeLessThanOrEqual(a.estateReal.p50 + 1e-6);
    expect(a.estateReal.p50).toBeLessThanOrEqual(a.estateReal.p90 + 1e-6);
    expect(a.trials).toBe(80);
    expect(a.inPlanDeathRate).toBeGreaterThan(0);
    expect(a.inPlanDeathRate).toBeLessThanOrEqual(1);
    expect(a.baselineEstateReal).toBeGreaterThan(0);
  }, 60_000);

  it("different seeds change the path distribution", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const a = runStochasticLongevity(h, { trials: 60, seed: 1 });
    const b = runStochasticLongevity(h, { trials: 60, seed: 99 });
    // Extremely unlikely to match on all summary stats
    const same =
      a.successRate === b.successRate &&
      a.estateReal.p50 === b.estateReal.p50 &&
      a.inPlanDeathRate === b.inPlanDeathRate;
    expect(same).toBe(false);
  }, 60_000);
});
