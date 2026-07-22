import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { tuneStrategyBanded } from "./tuneBandedC";
import { effectiveYearCeiling } from "../simulate";
import { analyzePlan } from "./analysis";

describe("tuneStrategyBanded + OAS soft-cap", () => {
  it("returns three age bands and applies OAS soft-cap by default", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const res = tuneStrategyBanded(h, {
      maxCeiling: 120_000,
      coarseStep: 20_000,
      fineStep: 10_000,
      banded: true,
      oasSoftCap: true,
    });
    expect(res.bestCeilingBands.length).toBe(3);
    expect(res.bestCeilingBands.map((b) => b.untilAge)).toEqual([71, 80, 120]);
    expect(res.oasSoftCap).toBe(true);
    expect(res.flatCeilingToday).toBeGreaterThanOrEqual(0);
    expect(res.tuned.failedAnyYear).toBe(false);
    // Soft-cap: effective ceiling never exceeds OAS threshold in a retirement year
    const thr = 90_000; // approximate; use policy from a mid path year
    const row = res.tuned.rows.find((r) => r.solverActive);
    expect(row).toBeTruthy();
    if (row) {
      const ages = [row.persons[0].ageDec31, row.persons[1].ageDec31];
      const eff = effectiveYearCeiling(
        {
          topUpCeilingToday: res.bestCeilingToday,
          ceilingBands: res.bestCeilingBands,
          oasSoftCap: true,
        },
        ages[0],
        ages[1],
        row.cpiIndex,
        thr * row.cpiIndex
      );
      expect(eff).toBeLessThanOrEqual(thr * row.cpiIndex + 1e-6);
    }
  }, 120_000);

  it("analyzePlan writes bands onto PlanAnalysis", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const a = analyzePlan(h, { quick: true });
    expect(a.bestCeilingBands?.length).toBe(3);
    expect(a.oasSoftCap).toBe(true);
    expect(a.bestCeilingToday).toBe(a.bestCeilingBands![0].ceilingToday);
  }, 120_000);

  it("banded path is at least as good as flat on funded years / estate objective", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const flat = tuneStrategyBanded(h, {
      maxCeiling: 100_000,
      coarseStep: 25_000,
      fineStep: 10_000,
      banded: false,
      oasSoftCap: true,
    });
    const banded = tuneStrategyBanded(h, {
      maxCeiling: 100_000,
      coarseStep: 25_000,
      fineStep: 10_000,
      banded: true,
      oasSoftCap: true,
    });
    const fy = (r: typeof flat.tuned) => r.rows.reduce((n, row) => n + (row.failed ? 0 : 1), 0);
    const fFlat = fy(flat.tuned);
    const fBand = fy(banded.tuned);
    expect(fBand).toBeGreaterThanOrEqual(fFlat);
    if (fBand === fFlat) {
      expect(banded.tuned.afterTaxEstateReal + 1).toBeGreaterThanOrEqual(
        flat.tuned.afterTaxEstateReal
      );
    }
  }, 180_000);
});
