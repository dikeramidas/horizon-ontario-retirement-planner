import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { compareScenarios } from "./scenarioCompare";

describe("compareScenarios", () => {
  it("builds side-by-side metrics via real analyzePlan on both sides", () => {
    const base = sampleHousehold();
    for (const p of base.persons) p.db = undefined;

    const lean = structuredClone(base);
    lean.spendingTargetToday = 70_000;
    lean.persons[0].name = "Lean";

    const rich = structuredClone(base);
    rich.spendingTargetToday = 110_000;
    rich.persons[0].name = "Rich";

    const cmp = compareScenarios(
      { id: "a", label: "Lean spend", inputs: lean },
      { id: "b", label: "Rich spend", inputs: rich },
      { quick: true }
    );

    expect(cmp.left.spendingTargetToday).toBe(70_000);
    expect(cmp.right.spendingTargetToday).toBe(110_000);
    expect(cmp.deltas.spending).toBe(40_000);
    expect(cmp.left.funded).toBe(true);
    // Higher spend should not increase real estate (usually lower or similar)
    expect(cmp.right.estateReal).toBeLessThanOrEqual(cmp.left.estateReal + 1);
    expect(cmp.deltas.estateReal).toBeCloseTo(cmp.right.estateReal - cmp.left.estateReal, 0);
    expect(cmp.left.netWorthRealByYear.length).toBeGreaterThan(5);
    expect(cmp.right.netWorthRealByYear.length).toBeGreaterThan(5);
    expect(cmp.left.bestCeilingToday).toBeGreaterThanOrEqual(0);
    expect(cmp.right.bestCeilingToday).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
