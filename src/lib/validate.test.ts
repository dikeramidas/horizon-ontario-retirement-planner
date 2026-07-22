import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { validateHousehold, canAnalyze } from "./validate";

describe("validateHousehold", () => {
  it("accepts the sample couple", () => {
    const v = validateHousehold(sampleHousehold());
    expect(v.ok).toBe(true);
    expect(v.errors).toHaveLength(0);
    expect(canAnalyze(sampleHousehold())).toBe(true);
  });

  it("blocks zero spending and bad horizon", () => {
    const bad = sampleHousehold();
    bad.spendingTargetToday = 0;
    bad.horizonAgeYoungerSpouse = 50;
    const v = validateHousehold(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.field === "spendingTargetToday")).toBe(true);
    expect(v.errors.some((e) => e.field === "horizon")).toBe(true);
  });

  it("blocks ACB above unregistered balance", () => {
    const bad = sampleHousehold();
    bad.persons[0].balances = {
      ...bad.persons[0].balances,
      unregistered: { balance: 10_000, acb: 50_000 },
    };
    const v = validateHousehold(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.field.includes("acb"))).toBe(true);
  });

  it("warns on extreme returns entered as percents by mistake", () => {
    const h = sampleHousehold();
    h.persons[0].returns = { ...h.persons[0].returns, rrsp: 5.5 };
    const v = validateHousehold(h);
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => w.field.includes("returns"))).toBe(true);
  });
});
