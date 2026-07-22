import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import {
  deathYearFromAge,
  householdBothLive,
  householdWithFirstDeath,
  planEndYear,
  planStartYear,
  runLongevityScenarios,
  survivorshipFromRow,
  validateDeathAge,
} from "./longevityScenarios";
import { simulate } from "../simulate";

describe("longevityScenarios helpers", () => {
  it("maps death age to calendar year via engine age convention", () => {
    expect(deathYearFromAge(1975, 85)).toBe(2060);
  });

  it("rejects death ages already passed at plan start", () => {
    const h = sampleHousehold();
    // Alex birth 1975; at start ~2027 age ~52 — death at 50 is past
    const v = validateDeathAge(h, 0, 50);
    expect(v.ok).toBe(false);
  });

  it("accepts mid-horizon death ages for sample couple", () => {
    const h = sampleHousehold();
    const v = validateDeathAge(h, 0, 85);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.deathYear).toBeGreaterThanOrEqual(planStartYear(h));
      expect(v.deathYear).toBeLessThanOrEqual(planEndYear(h));
    }
  });

  it("householdWithFirstDeath enables survivorship; both-live disables it", () => {
    const h = sampleHousehold();
    const d = householdWithFirstDeath(h, 1, 2050, 0.7);
    expect(d.survivorship?.enabled).toBe(true);
    expect(d.survivorship?.firstDeathPerson).toBe(1);
    expect(d.survivorship?.firstDeathYear).toBe(2050);
    const b = householdBothLive(h);
    expect(b.survivorship?.enabled).toBeFalsy();
  });
});

describe("runLongevityScenarios", () => {
  it("returns baseline plus rows for each age × spouse", () => {
    const h = sampleHousehold();
    h.strategy = { ...(h.strategy ?? {}), topUpCeilingToday: 40_000 };
    const res = runLongevityScenarios(h, { deathAges: [85, 95], survivorSpendFrac: 0.7 });
    expect(res.rows[0].kind).toBe("baseline");
    expect(res.rows[0].funded).toBeDefined();
    expect(res.rows[0].skipped).toBeFalsy();
    // 1 baseline + 2 ages × 2 people
    expect(res.rows.length).toBe(1 + 2 * 2);
    const applied = res.rows.filter((r) => r.kind === "first_death" && !r.skipped);
    expect(applied.length).toBeGreaterThanOrEqual(2);
    for (const r of applied) {
      expect(r.firstDeathYear).toBeDefined();
      expect(r.estateReal).toBeDefined();
      expect(r.fundedYears).toBeGreaterThan(0);
    }
  });

  it("first-death path records death year on simulate result", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const v = validateDeathAge(h, 0, 80);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const res = simulate(householdWithFirstDeath(h, 0, v.deathYear, 0.7));
    expect(res.firstDeathYear).toBe(v.deathYear);
    expect(res.firstDeathPerson).toBe(0);
  });

  it("survivorshipFromRow can apply a death scenario", () => {
    const h = sampleHousehold();
    const grid = runLongevityScenarios(h, { deathAges: [85] });
    const row = grid.rows.find((r) => r.kind === "first_death" && !r.skipped);
    expect(row).toBeTruthy();
    const s = survivorshipFromRow(row!, 0.65);
    expect(s?.enabled).toBe(true);
    expect(s?.firstDeathYear).toBe(row!.firstDeathYear);
    expect(s?.survivorSpendFrac).toBe(0.65);
  });
});
