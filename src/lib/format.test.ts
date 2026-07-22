import { describe, it, expect } from "vitest";
import { money, pct, num } from "./format";

describe("formatters", () => {
  it("formats CAD money", () => {
    const s = money(95_000);
    expect(s).toMatch(/95/);
    expect(s).toMatch(/\$|CAD/);
  });

  it("formats compact millions", () => {
    const s = money(2_500_000, { compact: true });
    expect(s.toLowerCase()).toMatch(/2\.?5|2,5/);
  });

  it("formats dense table amounts as compact K", () => {
    const s = money(95_000, { dense: true });
    expect(s.toLowerCase()).toMatch(/95/);
    expect(s.length).toBeLessThan(money(95_000).length);
  });

  it("formats percent and numbers", () => {
    expect(pct(0.873, 1)).toBe("87.3%");
    expect(num(1234.5, 1)).toMatch(/1/);
  });
});
