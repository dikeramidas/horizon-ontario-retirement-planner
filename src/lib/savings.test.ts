import { describe, it, expect } from "vitest";
import { makeSavings, setPersonSavings, readSavingsMode, readSavingsValue } from "./savings";
import { samplePersonA } from "./sampleHousehold";

describe("savings helpers", () => {
  it("builds and applies savings specs", () => {
    expect(makeSavings("none", 0)).toEqual({ type: "none" });
    expect(makeSavings("fixed", 7000)).toEqual({ type: "fixed", amount: 7000 });
    expect(makeSavings("pctOfSalary", 0.12)).toEqual({ type: "pctOfSalary", pct: 0.12 });

    const p = setPersonSavings(samplePersonA(), "rrsp", "pctOfSalary", 0.15);
    expect(readSavingsMode(p.savings?.rrsp)).toBe("pctOfSalary");
    expect(readSavingsValue(p.savings?.rrsp)).toBeCloseTo(0.15);
  });
});
