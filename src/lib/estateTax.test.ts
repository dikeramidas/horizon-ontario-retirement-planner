import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { simulate } from "../simulate";
import { estateTaxOf } from "./estateTax";
import { POLICY_BASELINE } from "../constants-2026";

describe("estateTaxOf", () => {
  it("equals gross balances minus after-tax estate on a real simulate()", () => {
    const r = simulate({ ...sampleHousehold(), solverQuality: "thorough" });
    const tax = estateTaxOf(r);
    expect(tax).toBeCloseTo(r.finalBalances.total - r.afterTaxEstate, 6);
    expect(tax).toBeGreaterThan(0);
  });
});

describe("POLICY_BASELINE (C6)", () => {
  it("exposes tax year and retrieval date for the footer", () => {
    expect(POLICY_BASELINE.taxYear).toBe(2026);
    expect(POLICY_BASELINE.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(POLICY_BASELINE.jurisdiction).toMatch(/Ontario/i);
  });
});
