import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { needsShortfallHelp, suggestShortfallLevers } from "./shortfallLevers";
import type { SimulationResult } from "../simulate";
import type { MonteCarloResult } from "../mc";

function fakeDet(failed: boolean): SimulationResult {
  return {
    failedAnyYear: failed,
    firstFailureYear: failed ? 2040 : undefined,
  } as SimulationResult;
}

function fakeMc(successRate: number): MonteCarloResult {
  return { successRate, trials: 100, seed: 1 } as MonteCarloResult;
}

describe("shortfallLevers", () => {
  it("needs help when expected path fails", () => {
    expect(needsShortfallHelp(fakeDet(true), null)).toBe(true);
    expect(needsShortfallHelp(fakeDet(false), null)).toBe(false);
  });

  it("needs help when MC success is below threshold", () => {
    expect(needsShortfallHelp(fakeDet(false), fakeMc(0.7))).toBe(true);
    expect(needsShortfallHelp(fakeDet(false), fakeMc(0.95))).toBe(false);
  });

  it("apply spend-5 reduces lifestyle by 5%", () => {
    const h = sampleHousehold();
    const before = h.spendingTargetToday;
    const levers = suggestShortfallLevers(h, fakeDet(true), null);
    const spend5 = levers.find((L) => L.id === "spend-5")!;
    const next = spend5.apply(h);
    expect(next.spendingTargetToday).toBe(Math.round(before * 0.95));
  });

  it("apply retire-plus-1 bumps both retirement ages", () => {
    const h = sampleHousehold();
    const a0 = h.persons[0].retirementAge;
    const a1 = h.persons[1].retirementAge;
    const lever = suggestShortfallLevers(h, fakeDet(true), null).find((L) => L.id === "retire-plus-1")!;
    const next = lever.apply(h);
    expect(next.persons[0].retirementAge).toBe(Math.min(75, a0 + 1));
    expect(next.persons[1].retirementAge).toBe(Math.min(75, a1 + 1));
  });
});
