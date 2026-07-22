import { describe, it, expect } from "vitest";
import {
  typicalFirstShortfallYear,
  failureRate,
  countFailingTrials,
} from "./mcSummary";

describe("mcSummary", () => {
  it("returns null when no failures", () => {
    expect(typicalFirstShortfallYear([])).toBeNull();
  });

  it("picks the year with the most first-failures (mode)", () => {
    const y = typicalFirstShortfallYear([
      { year: 2035, count: 2 },
      { year: 2040, count: 15 },
      { year: 2042, count: 5 },
    ]);
    expect(y).toBe(2040);
  });

  it("tie-breaks to earlier year", () => {
    const y = typicalFirstShortfallYear([
      { year: 2045, count: 10 },
      { year: 2038, count: 10 },
    ]);
    expect(y).toBe(2038);
  });

  it("failureRate and failing trial counts", () => {
    expect(failureRate({ successRate: 0.9 })).toBeCloseTo(0.1, 9);
    expect(
      countFailingTrials([
        { year: 2030, count: 3 },
        { year: 2040, count: 7 },
      ])
    ).toBe(10);
  });
});
