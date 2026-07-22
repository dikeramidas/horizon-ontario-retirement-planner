import { describe, it, expect } from "vitest";
import { sampleHousehold } from "../src/lib/sampleHousehold";
import { simulate } from "../src/simulate";

describe("B2 first-death survivorship (scoped)", () => {
  it("rolls registered assets to survivor and steps down spend after death year", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const start = h.startYear ?? 2026;
    const deathYear = start + 15;
    h.survivorship = {
      enabled: true,
      firstDeathPerson: 0,
      firstDeathYear: deathYear,
      survivorSpendFrac: 0.7,
    };
    h.spendingTargetToday = 80_000;

    const res = simulate({ ...h, solverQuality: "thorough" });
    expect(res.firstDeathYear).toBe(deathYear);
    expect(res.firstDeathPerson).toBe(0);

    const deathRow = res.rows.find((r) => r.year === deathYear)!;
    const after = res.rows.find((r) => r.year === deathYear + 1)!;
    expect(deathRow).toBeTruthy();
    expect(after).toBeTruthy();

    // After death, deceased registered balances should be ~0
    const deadEnd = after.persons[0].balancesEnd;
    expect(deadEnd.rrsp + deadEnd.lira + deadEnd.dcPension + deadEnd.lif).toBeLessThan(1);

    // Survivor holds material assets
    const liveEnd = after.persons[1].balancesEnd;
    expect(
      liveEnd.rrsp + liveEnd.tfsa + liveEnd.unregistered + liveEnd.lif
    ).toBeGreaterThan(100_000);

    // Spending target after death is stepped down (nominal vs death year)
    if (after.solverActive && deathRow.solverActive) {
      const ratio = after.spendingTarget / deathRow.spendingTarget;
      // ~0.7 × one year of inflation (~2%)
      expect(ratio).toBeGreaterThan(0.65);
      expect(ratio).toBeLessThan(0.78);
    }
  });
});
