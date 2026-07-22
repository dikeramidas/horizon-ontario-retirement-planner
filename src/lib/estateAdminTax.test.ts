import { describe, it, expect } from "vitest";
import { ontarioEstateAdminTax } from "./estateAdminTax";
import { sampleHousehold } from "./sampleHousehold";
import { simulate } from "../simulate";

describe("ontarioEstateAdminTax", () => {
  it("is zero on empty estate", () => {
    expect(ontarioEstateAdminTax(0)).toBe(0);
  });

  it("applies 0.5% on first $50k and 1.5% above", () => {
    expect(ontarioEstateAdminTax(50_000)).toBeCloseTo(250, 6);
    expect(ontarioEstateAdminTax(150_000)).toBeCloseTo(250 + 100_000 * 0.015, 6);
  });

  it("surfaces on a full simulate path", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const r = simulate({ ...h, solverQuality: "thorough" });
    expect(r.estateAdminTax ?? 0).toBeGreaterThan(0);
    expect(r.estateAdminTaxReal ?? 0).toBeGreaterThan(0);
    // Not folded into afterTaxEstate
    expect(r.afterTaxEstate).toBeGreaterThan(r.estateAdminTax!);
  });
});
