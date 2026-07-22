import { describe, it, expect } from "vitest";
import { simulate } from "../engine-entry";
import { sampleHousehold } from "./sampleHousehold";
import {
  buildDrawdownLedger,
  retirementDrawdown,
  flattenPersonDrawdown,
  balanceTrackSeries,
  matchesEngineRow,
} from "./drawdown";

describe("drawdown ledger (live simulate)", () => {
  const input = sampleHousehold();
  const names: [string, string] = [input.persons[0].name, input.persons[1].name];
  const res = simulate({ ...input, solverQuality: "thorough" });

  it("exposes non-empty retirement years with both persons", () => {
    const years = retirementDrawdown(res, names);
    expect(years.length).toBeGreaterThan(5);
    expect(years.every((y) => y.solverActive)).toBe(true);
    for (const y of years) {
      expect(y.persons[0].name).toBe(names[0]);
      expect(y.persons[1].name).toBe(names[1]);
      expect(y.persons[0].personIndex).toBe(0);
      expect(y.persons[1].personIndex).toBe(1);
    }
  });

  it("person-level withdrawals match engine YearRow exactly", () => {
    const years = retirementDrawdown(res, names);
    const byYear = new Map(res.rows.map((r) => [r.year, r]));
    let checked = 0;
    for (const y of years) {
      const row = byYear.get(y.year)!;
      expect(matchesEngineRow(y, row)).toBe(true);
      for (const i of [0, 1] as const) {
        const eng = row.persons[i].withdrawals;
        const d = y.persons[i].withdrawals;
        expect(d.registered).toBeCloseTo(eng.registered, 6);
        expect(d.lif).toBeCloseTo(eng.lif, 6);
        expect(d.tfsa).toBeCloseTo(eng.tfsa, 6);
        expect(d.unregistered).toBeCloseTo(eng.unregistered, 6);
        expect(d.topUp).toBeCloseTo(eng.topUp, 6);
        expect(d.total).toBeCloseTo(
          eng.registered + eng.lif + eng.tfsa + eng.unregistered + eng.topUp,
          6
        );
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // At least one year has a real withdrawal from someone
    const anyDraw = years.some(
      (y) => y.persons[0].withdrawals.total + y.persons[1].withdrawals.total > 1
    );
    expect(anyDraw).toBe(true);
  });

  it("balancesEnd match engine; openings equal prior year end", () => {
    const full = buildDrawdownLedger(res, names, { retirementOnly: false });
    expect(full.length).toBe(res.rows.length);
    for (let i = 0; i < full.length; i++) {
      const y = full[i];
      const row = res.rows[i];
      for (const pi of [0, 1] as const) {
        const be = row.persons[pi].balancesEnd;
        expect(y.persons[pi].balancesEnd.rrsp).toBeCloseTo(be.rrsp, 6);
        expect(y.persons[pi].balancesEnd.lif).toBeCloseTo(be.lif, 6);
        expect(y.persons[pi].balancesEnd.tfsa).toBeCloseTo(be.tfsa, 6);
        expect(y.persons[pi].balancesEnd.unregistered).toBeCloseTo(be.unregistered, 6);
        expect(y.persons[pi].balancesEnd.lira).toBeCloseTo(be.lira, 6);
        expect(y.persons[pi].balancesEnd.dcPension).toBeCloseTo(be.dcPension, 6);
      }
      if (i > 0) {
        const prev = full[i - 1];
        expect(y.persons[0].balancesOpen.total).toBeCloseTo(prev.persons[0].balancesEnd.total, 6);
        expect(y.persons[1].balancesOpen.rrsp).toBeCloseTo(prev.persons[1].balancesEnd.rrsp, 6);
        expect(y.persons[0].balancesOpen.tfsa).toBeCloseTo(prev.persons[0].balancesEnd.tfsa, 6);
      }
    }
    // Sample path should still have positive household assets mid-retirement
    const mid = retirementDrawdown(res, names);
    const midRow = mid[Math.floor(mid.length / 3)];
    expect(midRow.householdBalancesEnd.total).toBeGreaterThan(0);
  });

  it("flat and balance series preserve person attribution", () => {
    const years = retirementDrawdown(res, names);
    const flat = flattenPersonDrawdown(years);
    expect(flat.length).toBe(years.length * 2);
    const aRows = flat.filter((r) => r.personIndex === 0);
    const bRows = flat.filter((r) => r.personIndex === 1);
    expect(aRows.every((r) => r.name === names[0])).toBe(true);
    expect(bRows.every((r) => r.name === names[1])).toBe(true);

    const bal = balanceTrackSeries(years);
    expect(bal.length).toBe(years.length * 2);
    expect(bal.some((p) => p.rrsp > 0 || p.tfsa > 0 || p.lif > 0)).toBe(true);
  });

  it("ledger is one logical year row with both persons as columns (not stacked rows)", () => {
    const years = retirementDrawdown(res, names);
    // UI contract: years[] length = table body row count; each entry has both persons
    expect(years.length).toBeGreaterThan(10);
    const yearsUnique = new Set(years.map((y) => y.year));
    expect(yearsUnique.size).toBe(years.length); // one entry per calendar year
    for (const y of years) {
      expect(y.persons).toHaveLength(2);
      expect(y.persons[0].name).toBe(names[0]);
      expect(y.persons[1].name).toBe(names[1]);
      // both person withdrawal objects present (values may be zero)
      expect(y.persons[0].withdrawals).toBeDefined();
      expect(y.persons[1].withdrawals).toBeDefined();
      expect(y.persons[0].balancesEnd).toBeDefined();
      expect(y.persons[1].balancesEnd).toBeDefined();
    }
  });
});
