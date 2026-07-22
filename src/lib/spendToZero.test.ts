import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { findMaxSpendToZero } from "./spendToZero";
import { analyzePlan } from "./analysis";
import { simulate } from "../simulate";

describe("findMaxSpendToZero", () => {
  it("re-grids C at each spend trial (default) and returns a funded spend", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    h.spendingTargetToday = 80_000;

    const res = findMaxSpendToZero(h, {
      estateEps: 100_000,
      maxIters: 8,
      analyzeOpts: { quick: true },
      retuneStrategy: true,
    });

    expect(res.retunedStrategy).toBe(true);
    expect(res.iterations).toBeGreaterThan(2);
    expect(res.maxSpendToday).toBeGreaterThan(10_000);
    expect(res.funded).toBe(true);
    expect(res.failedAnyYear).toBe(false);

    // Winning (spend, C, share) must actually fund when re-simulated
    const check = simulate({
      ...h,
      spendingTargetToday: res.maxSpendToday,
      solverQuality: "thorough",
      strategy: {
        ...(h.strategy ?? {}),
        topUpCeilingToday: res.ceilingUsed,
        tfsaLevel: "l4",
        tfsaFirstShare: res.tfsaFirstShare,
      },
    });
    expect(check.failedAnyYear).toBe(false);

    // C at the winning spend should match a fresh analyzePlan at that spend (quick grid)
    const atWin = analyzePlan(
      { ...h, spendingTargetToday: res.maxSpendToday },
      { quick: true }
    );
    expect(res.ceilingUsed).toBe(atWin.bestCeilingToday);
  }, 180_000);

  it("pin mode keeps baseline C when retuneStrategy is false", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    h.spendingTargetToday = 70_000;
    const baseline = analyzePlan(h, { quick: true });
    const res = findMaxSpendToZero(h, {
      estateEps: 100_000,
      maxIters: 8,
      analyzeOpts: { quick: true },
      retuneStrategy: false,
      baseline,
    });
    expect(res.retunedStrategy).toBe(false);
    expect(res.ceilingUsed).toBe(baseline.bestCeilingToday);
    expect(res.funded).toBe(true);
  }, 120_000);
});
