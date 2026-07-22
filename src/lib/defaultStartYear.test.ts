import { describe, it, expect } from "vitest";
import { defaultStartYear } from "./defaultStartYear";

describe("defaultStartYear", () => {
  it("uses current year only on January 1", () => {
    expect(defaultStartYear(new Date(2026, 0, 1))).toBe(2026);
  });

  it("uses next year after January 1 (including mid-year)", () => {
    expect(defaultStartYear(new Date(2026, 0, 2))).toBe(2027);
    expect(defaultStartYear(new Date(2026, 6, 21))).toBe(2027);
    expect(defaultStartYear(new Date(2026, 11, 31))).toBe(2027);
  });
});
