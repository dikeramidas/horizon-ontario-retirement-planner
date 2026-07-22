/**
 * Gate 5 fuzz: random households, deterministic and stochastic paths,
 * asserting engine invariants the unit tests state only for hand-built cases.
 */
/**
 * Gate 5 fuzz regression: 250 seeded random households (mixed deterministic /
 * stochastic paths, both solver modes) must satisfy the engine invariants —
 * conservation ≤ $1, achieved-vs-target consistency, forced minimums, LIF
 * caps, non-negative balances/rooms, and no phantom money from the growth
 * clamp. This harness found and pinned two real bugs (split-refine
 * regression; negative-return over-withdrawal) on 2026-07-19.
 */
import { describe, it, expect } from "vitest";
import { simulate, type HouseholdInput } from "../src/simulate";
import { generateTrialPath, mulberry32 } from "../src/mc";

const rng = mulberry32(20260719);
const U = (lo: number, hi: number) => lo + rng() * (hi - lo);
const I = (lo: number, hi: number) => Math.floor(U(lo, hi + 1));
const maybe = (p: number) => rng() < p;

function randomHousehold(): HouseholdInput {
  const person = (birthLo: number, birthHi: number) => {
    const unregBal = maybe(0.5) ? U(0, 800_000) : 0;
    return {
      name: "P", birthYear: I(birthLo, birthHi), retirementAge: I(55, 70),
      salaryToday: maybe(0.8) ? U(30_000, 220_000) : 0,
      salaryRealGrowth: U(0, 0.02),
      savings: {
        rrsp: maybe(0.7) ? { type: "pctOfSalary" as const, pct: U(0.02, 0.18) } : { type: "none" as const },
        tfsa: maybe(0.5) ? { type: "fixed" as const, amount: U(1_000, 8_000) } : { type: "none" as const },
        dc: maybe(0.3) ? { type: "pctOfSalary" as const, pct: U(0.03, 0.12) } : { type: "none" as const },
      },
      rrspRoomNow: U(0, 80_000), tfsaRoomNow: U(0, 90_000),
      cpp: maybe(0.9) ? { annualAt65Today: U(4_000, 17_000), startAge: I(60, 70) } : undefined,
      oas: { startAge: I(65, 70), residenceYears: I(10, 40) },
      db: maybe(0.25) ? { currentAnnualEntitlementToday: U(5_000, 60_000), startAge: I(55, 65), indexedToCpi: maybe(0.5) } : undefined,
      balances: {
        rrsp: maybe(0.85) ? U(0, 1_800_000) : 0,
        lira: maybe(0.35) ? U(0, 600_000) : 0,
        dcPension: maybe(0.25) ? U(0, 500_000) : 0,
        tfsa: maybe(0.8) ? U(0, 300_000) : 0,
        unregistered: unregBal > 0 ? { balance: unregBal, acb: U(0.2, 1) * unregBal } : undefined,
      },
      returns: { rrsp: U(0, 0.08), lira: U(0, 0.08), dcPension: U(0, 0.08), tfsa: U(0, 0.08), unregistered: U(0, 0.08) },
      unregisteredDistribution: { interestFrac: U(0, 0.3), eligibleDividendFrac: U(0, 0.4), realizedGainFrac: U(0, 0.3) },
      lifUnlock50: maybe(0.7),
      rrifUseYoungerSpouseAge: maybe(0.8),
    };
  };
  return {
    startYear: 2026, inflation: U(0, 0.04),
    spendingTargetToday: U(35_000, 160_000),
    horizonAgeYoungerSpouse: I(88, 100),
    strategy: { topUpCeilingToday: maybe(0.5) ? U(0, 120_000) : 0 },
    persons: [person(1950, 1990), person(1950, 1990)] as any,
  };
}

describe("fuzz invariants (250 seeded random households)", () => {
  it("holds every engine invariant with zero phantom money", { timeout: 30_000 }, () => {
let runs = 0, violations = 0, clampEvents = 0, clampDollars = 0, worstResidual = 0;
const report: string[] = [];

for (let k = 0; k < 250; k++) {
  const input = randomHousehold();
  const stochastic = maybe(0.5);
  const full: HouseholdInput = stochastic
    ? { ...input, solverQuality: "fast", path: generateTrialPath(input, { seed: 1000 + k, defaultVol: U(0.05, 0.25) }, 0) }
    : { ...input, solverQuality: maybe(0.5) ? "thorough" : "fast" };
  let res;
  try { res = simulate(full); } catch (e) {
    violations++; report.push(`#${k} THROW: ${(e as Error).message}`); continue;
  }
  runs++;
  const V = (cond: boolean, msg: string) => { if (!cond) { violations++; if (report.length < 12) report.push(`#${k} ${msg}`); } };

  let prevOpen: any = null;
  for (const row of res.rows) {
    if (row.solverActive) {
      worstResidual = Math.max(worstResidual, Math.abs(row.conservationResidual));
      V(Math.abs(row.conservationResidual) <= 1.01, `conservation ${row.conservationResidual.toFixed(2)} in ${row.year}`);
      V(row.spendingAchieved <= row.spendingTarget + 0.01, `achieved > target in ${row.year}`);
      V(row.failed || row.spendingAchieved >= row.spendingTarget - 1.01, `not failed but short in ${row.year}`);
    }
    for (const i of [0, 1] as const) {
      const p = row.persons[i];
      V(p.withdrawals.registered >= p.rrifMin - 1e-6, `registered < rrifMin in ${row.year}`);
      if (p.lifMax > 0) V(p.withdrawals.lif <= p.lifMax + 1e-6, `lif ${p.withdrawals.lif.toFixed(2)} > max ${p.lifMax.toFixed(2)} in ${row.year}`);
      V(p.withdrawals.lif >= p.lifMin - 1e-6, `lif < min in ${row.year}`);
      for (const [acct, v] of Object.entries(p.balancesEnd)) V((v as number) >= -1e-6, `${acct} negative in ${row.year}`);
      V(p.roomsEnd.rrsp >= -1e-6 && p.roomsEnd.tfsa >= -1e-6, `room negative in ${row.year}`);
      // phantom-money detector: withdrawal so large that pre-clamp end < 0.
      // Skip LIF-conversion years: section A moves LIRA/DC into LIF and RRSP at
      // the START of the year, so last year's END balances understate openings.
      const converted = prevOpen && prevOpen[i].lif === 0 && (p.balancesEnd.lif > 0 || p.withdrawals.lif > 0);
      if (prevOpen && !converted) {
        const rr = (full.path?.returnsByYear?.[row.year - (full.startYear ?? 2026)]?.[i]) ?? full.persons[i].returns ?? {};
        const chk = (open: number, r: number, flow: number) => {
          const raw = open * (1 + r) + flow * (1 + r / 2);
          if (raw < -0.01) { clampEvents++; clampDollars += -raw; }
        };
        chk(prevOpen[i].rrsp, (rr as any).rrsp ?? 0, p.contributions.rrsp - (p.withdrawals.registered + p.withdrawals.topUp));
        chk(prevOpen[i].tfsa, (rr as any).tfsa ?? 0, p.contributions.tfsa - p.withdrawals.tfsa);
        chk(prevOpen[i].unreg, (rr as any).unregistered ?? 0, p.contributions.unregistered - p.withdrawals.unregistered);
        chk(prevOpen[i].lif, (rr as any).lira ?? 0, -p.withdrawals.lif);
      }
    }
    prevOpen = [0, 1].map((i) => {
      const b = row.persons[i].balancesEnd;
      return { rrsp: b.rrsp, tfsa: b.tfsa, unreg: b.unregistered, lif: b.lif };
    });
  }
}
if (report.length) console.log(report.join("\n"));
console.log(`[fuzz] ${runs}/250 ran | worst conservation residual $${worstResidual.toFixed(3)} | phantom $${Math.round(clampDollars)}`);
expect(runs).toBe(250);
expect(violations).toBe(0);
expect(worstResidual).toBeLessThanOrEqual(1.01);
expect(clampDollars).toBeLessThan(1);
  });
});
