import { describe, it, expect } from "vitest";
import { estimateGis } from "./gis";
import { GIS } from "../constants-2026";

describe("estimateGis", () => {
  it("is zero without OAS", () => {
    expect(
      estimateGis({
        oasGross: 0,
        otherIncome: 0,
        spouseHasOas: false,
        spouseOtherIncome: 0,
        cpi: 1,
      })
    ).toBe(0);
  });

  it("pays near max for single with no other income", () => {
    const g = estimateGis({
      oasGross: 9_000,
      otherIncome: 0,
      spouseHasOas: false,
      spouseOtherIncome: 0,
      cpi: 1,
    });
    expect(g).toBeCloseTo(GIS.maxAnnualSingle.value, 0);
  });

  it("reduces 50% of other income for singles", () => {
    const g = estimateGis({
      oasGross: 9_000,
      otherIncome: 4_000,
      spouseHasOas: false,
      spouseOtherIncome: 0,
      cpi: 1,
    });
    expect(g).toBeCloseTo(GIS.maxAnnualSingle.value - 0.5 * 4_000, 4);
  });

  it("uses partner max when spouse has OAS", () => {
    const g = estimateGis({
      oasGross: 9_000,
      otherIncome: 0,
      spouseHasOas: true,
      spouseOtherIncome: 0,
      cpi: 1,
    });
    expect(g).toBeCloseTo(GIS.maxAnnualPartner.value, 0);
    expect(g).toBeLessThan(GIS.maxAnnualSingle.value);
  });
});
