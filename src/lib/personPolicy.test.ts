import { describe, it, expect } from "vitest";
import {
  assignPersonTopUps,
  parkSurplusTfsaFirst,
  personOrder,
  scaleTopUpsToTfsaRoom,
  splitCeilingByRegistered,
} from "./personPolicy";
import { sampleHousehold } from "./sampleHousehold";
import { analyzePlan } from "./analysis";
import { simulate } from "../simulate";

describe("personPolicy helpers", () => {
  it("orders higher registered first", () => {
    expect(personOrder("higherReg", 100, 50)).toEqual([0, 1]);
    expect(personOrder("higherReg", 10, 50)).toEqual([1, 0]);
    expect(personOrder("prefer1", 100, 50)).toEqual([1, 0]);
  });

  it("assigns top-ups under per-person ceilings in priority order", () => {
    const top = assignPersonTopUps(
      [50_000, 50_000],
      [40_000, 10_000],
      [100_000, 100_000],
      [1, 0]
    );
    // Person 1 has more room under C (40k) and is first
    expect(top[1]).toBe(40_000);
    expect(top[0]).toBe(10_000);
  });

  it("parks surplus into the spouse with more TFSA room first", () => {
    const { tfsaAdd, residual } = parkSurplusTfsaFirst(30_000, [5_000, 40_000]);
    expect(tfsaAdd[1]).toBe(30_000);
    expect(tfsaAdd[0]).toBe(0);
    expect(residual).toBe(0);
    const partial = parkSurplusTfsaFirst(50_000, [10_000, 15_000]);
    expect(partial.tfsaAdd[0] + partial.tfsaAdd[1]).toBe(25_000);
    expect(partial.residual).toBe(25_000);
  });

  it("scales top-ups to fit TFSA room after tax", () => {
    const scaled = scaleTopUpsToTfsaRoom([100_000, 0], 32_500, 0.65);
    // 100k * 0.65 = 65k after tax; room 32.5k → scale 0.5
    expect(scaled[0]).toBeCloseTo(50_000, 0);
    expect(scaled[1]).toBe(0);
  });

  it("splits flat C by registered balances with floors", () => {
    const [a, b] = splitCeilingByRegistered(100_000, 300_000, 100_000);
    expect(a + b).toBeCloseTo(100_000, 5);
    expect(a).toBeGreaterThan(b);
    expect(a).toBeGreaterThanOrEqual(25_000);
    expect(b).toBeGreaterThanOrEqual(25_000);
  });
});

describe("person policy on real simulate path", () => {
  it("analyzePlan sets person ceilings and parks surplus preferentially to TFSA", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const a = analyzePlan(h, { quick: true });
    expect(a.personCeilingsToday).toBeDefined();
    expect(a.personCeilingsToday![0] + a.personCeilingsToday![1]).toBeGreaterThan(0);

    // Path with person policy should run without failure on sample
    const res = simulate({
      ...h,
      solverQuality: "thorough",
      strategy: {
        ...(h.strategy ?? {}),
        topUpCeilingToday: a.bestCeilingToday,
        ceilingBands: a.bestCeilingBands,
        oasSoftCap: true,
        personCeilingsToday: a.personCeilingsToday,
        topUpPriority: "higherReg",
        tfsaAwareMeltdown: true,
        tfsaLevel: "l4",
        tfsaFirstShare: a.tfsaTune?.bestShare ?? 0,
      },
    });
    expect(res.failedAnyYear).toBe(false);
    const surplusTfsa = res.rows.reduce((s, r) => s + r.surplusToTfsa, 0);
    // Meltdown years should park something into TFSA when room exists
    expect(surplusTfsa).toBeGreaterThan(0);
  }, 120_000);
});
