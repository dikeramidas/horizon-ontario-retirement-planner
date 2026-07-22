import { describe, it, expect } from "vitest";
import { simulate } from "../engine-entry";
import { sampleHousehold } from "./sampleHousehold";
import { cashflowSeries, yearCashflow, householdNetWorth, personNetWorth } from "./cashflow";

describe("cashflow mappers (real engine path)", () => {
  it("exposes per-account withdrawals from a live simulate()", () => {
    const res = simulate({ ...sampleHousehold(), solverQuality: "thorough" });
    expect(res.rows.length).toBeGreaterThan(10);
    expect(res.failedAnyYear).toBe(false);

    const series = cashflowSeries(res, true);
    expect(series.length).toBeGreaterThan(5);

    const withDraw = series.find(
      (r) => r.registered + r.unregistered + r.tfsa + r.lif + r.topUp > 0
    );
    expect(withDraw).toBeTruthy();
    expect(withDraw!.year).toBeGreaterThanOrEqual(2026);

    const row = res.rows.find((r) => r.solverActive)!;
    const slice = yearCashflow(row);
    const wa = row.persons[0].withdrawals;
    const wb = row.persons[1].withdrawals;
    expect(slice.registered).toBeCloseTo(wa.registered + wb.registered, 6);
    expect(slice.tfsa).toBeCloseTo(wa.tfsa + wb.tfsa, 6);
    expect(slice.tax).toBeCloseTo(row.householdTax, 6);

    const nw = householdNetWorth(row);
    expect(nw).toBeGreaterThan(0);
    const nwa = personNetWorth(row, 0);
    const nwb = personNetWorth(row, 1);
    expect(nwa + nwb).toBeCloseTo(nw, 6);
    expect(nwa).toBeGreaterThanOrEqual(0);
    expect(nwb).toBeGreaterThanOrEqual(0);
  });
});
