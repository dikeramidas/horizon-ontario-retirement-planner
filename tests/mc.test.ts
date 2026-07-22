/**
 * Gate 3 tests — Monte Carlo runner, path generator, strategy tuner.
 *
 * The zero-volatility equivalence tests compare like-for-like: the MC runner
 * forces solverQuality "fast", so equivalence is asserted against a "fast"
 * deterministic run (bit-identical), and the fast-vs-thorough gap is bounded
 * separately (documented ~0.15% lifetime-tax noise).
 */
import { describe, it, expect } from "vitest";
import { simulate, type HouseholdInput } from "../src/simulate";
import {
  mulberry32, deriveSeed, gaussianFactory,
  generateTrialPath, runMonteCarlo, tuneStrategy,
} from "../src/mc";

const couple = (): HouseholdInput => ({
  startYear: 2026, inflation: 0.021, spendingTargetToday: 90_000,
  persons: [
    { name: "A", birthYear: 1971, retirementAge: 65, salaryToday: 120_000,
      savings: { rrsp: { type: "pctOfSalary", pct: 0.10 } }, rrspRoomNow: 40_000, tfsaRoomNow: 30_000,
      cpp: { annualAt65Today: 14_000, startAge: 65 }, oas: { startAge: 65, residenceYears: 40 },
      balances: { rrsp: 600_000, tfsa: 100_000, unregistered: { balance: 200_000, acb: 120_000 } },
      returns: { rrsp: 0.05, tfsa: 0.05, unregistered: 0.055 },
      unregisteredDistribution: { interestFrac: 0.1, eligibleDividendFrac: 0.35, realizedGainFrac: 0.15 } },
    { name: "B", birthYear: 1973, retirementAge: 65, salaryToday: 90_000,
      savings: { rrsp: { type: "pctOfSalary", pct: 0.08 } }, rrspRoomNow: 25_000, tfsaRoomNow: 40_000,
      cpp: { annualAt65Today: 11_000, startAge: 65 }, oas: { startAge: 65, residenceYears: 40 },
      balances: { rrsp: 400_000, lira: 150_000, tfsa: 80_000 },
      returns: { rrsp: 0.05, tfsa: 0.05, unregistered: 0.055, lira: 0.05 } },
  ],
});

describe("RNG determinism", () => {
  it("mulberry32 streams are reproducible and seed-dependent", () => {
    const a1 = mulberry32(42), a2 = mulberry32(42), b = mulberry32(43);
    const s1 = [a1(), a1(), a1()], s2 = [a2(), a2(), a2()], s3 = [b(), b(), b()];
    expect(s1).toEqual(s2);
    expect(s1).not.toEqual(s3);
    for (const x of s1) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });

  it("deriveSeed decorrelates adjacent trials", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 1000; t++) seen.add(deriveSeed(1, t));
    expect(seen.size).toBe(1000); // no collisions across 1,000 trials
  });

  it("gaussianFactory is deterministic with mean ~0 and sd ~1", () => {
    const g = gaussianFactory(mulberry32(7));
    let sum = 0, sum2 = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) { const z = g(); sum += z; sum2 += z * z; }
    expect(Math.abs(sum / N)).toBeLessThan(0.02);
    expect(Math.abs(sum2 / N - 1)).toBeLessThan(0.03);
  });
});

describe("zero-volatility equivalence (§9 exit criterion)", () => {
  it("path generator emits the fixed returns exactly at sigma = 0", () => {
    const input = couple();
    const path = generateTrialPath(input, { defaultVol: 0, inflation: { kind: "fixed" }, seed: 5 }, 0);
    expect(path.inflationByYear).toBeUndefined(); // fixed → simulate uses input.inflation, bit-identical
    for (const [a, b] of path.returnsByYear!) {
      expect(a.rrsp).toBe(0.05);
      expect(a.unregistered).toBe(0.055);
      expect(a.lira).toBe(0);       // unspecified account → µ = 0, exact
      expect(b.lira).toBe(0.05);
      expect(b.tfsa).toBe(0.05);
    }
  });

  it("a zero-vol trial is bit-identical to the deterministic fast run", () => {
    const input = couple();
    const path = generateTrialPath(input, { defaultVol: 0, inflation: { kind: "fixed" } }, 0);
    const det = simulate({ ...input, solverQuality: "fast" });
    const mc = simulate({ ...input, solverQuality: "fast", path });
    expect(mc.lifetimeTax).toBe(det.lifetimeTax);
    expect(mc.afterTaxEstate).toBe(det.afterTaxEstate);
    expect(mc.failedAnyYear).toBe(det.failedAnyYear);
    expect(JSON.stringify(mc.rows)).toBe(JSON.stringify(det.rows));
  });

  it("runMonteCarlo at zero vol reproduces the deterministic aggregates", () => {
    const input = couple();
    const det = simulate({ ...input, solverQuality: "fast" });
    const res = runMonteCarlo(input, { trials: 3, defaultVol: 0, inflation: { kind: "fixed" } });
    expect(res.successRate).toBe(det.failedAnyYear ? 0 : 1);
    expect(res.estateReal.p50).toBe(det.afterTaxEstateReal);
    expect(res.lifetimeTax.p50).toBe(det.lifetimeTax);
  });

  it("fast solver tracks thorough within 0.5% lifetime tax (documented noise)", () => {
    const input = couple();
    const thorough = simulate({ ...input, solverQuality: "thorough" });
    const fast = simulate({ ...input, solverQuality: "fast" });
    expect(thorough.failedAnyYear).toBe(fast.failedAnyYear);
    expect(Math.abs(fast.lifetimeTax - thorough.lifetimeTax) / thorough.lifetimeTax).toBeLessThan(0.005);
    expect(fast.lifetimeTax).toBeGreaterThanOrEqual(thorough.lifetimeTax - 1); // fast never beats thorough materially
  });
});

describe("seed reproducibility", () => {
  it("same seed → identical results; different seed → different draws", () => {
    const input = couple();
    const cfg = { trials: 60, seed: 11, defaultVol: 0.12 } as const;
    const r1 = runMonteCarlo(input, { ...cfg });
    const r2 = runMonteCarlo(input, { ...cfg });
    expect(r1.successRate).toBe(r2.successRate);
    expect(r1.estateReal).toEqual(r2.estateReal);
    expect(r1.netWorthRealPercentiles.p50).toEqual(r2.netWorthRealPercentiles.p50);
    const r3 = runMonteCarlo(input, { ...cfg, seed: 12 });
    expect(r3.netWorthRealPercentiles.p50).not.toEqual(r1.netWorthRealPercentiles.p50);
  });
});

describe("Monte Carlo sanity and monotonicity", () => {
  it("higher spending cannot raise the success rate (same seed)", () => {
    const lo = runMonteCarlo({ ...couple(), spendingTargetToday: 60_000 }, { trials: 120, seed: 3 });
    const hi = runMonteCarlo({ ...couple(), spendingTargetToday: 110_000 }, { trials: 120, seed: 3 });
    expect(hi.successRate).toBeLessThanOrEqual(lo.successRate);
  });

  it("doubling assets cannot lower the success rate (same seed)", () => {
    const base = couple();
    const rich = couple();
    rich.persons[0].balances = { rrsp: 1_200_000, tfsa: 200_000, unregistered: { balance: 400_000, acb: 240_000 } };
    rich.persons[1].balances = { rrsp: 800_000, lira: 300_000, tfsa: 160_000 };
    const r1 = runMonteCarlo({ ...base, spendingTargetToday: 105_000 }, { trials: 120, seed: 3 });
    const r2 = runMonteCarlo({ ...rich, spendingTargetToday: 105_000 }, { trials: 120, seed: 3 });
    expect(r2.successRate).toBeGreaterThanOrEqual(r1.successRate);
  });

  it("percentile bands are ordered and span the horizon", () => {
    const res = runMonteCarlo(couple(), { trials: 100, seed: 9 });
    const P = res.netWorthRealPercentiles;
    expect(P.p50.length).toBe(res.years);
    for (const y of [0, 10, 25, res.years - 1]) {
      expect(P.p10[y]).toBeLessThanOrEqual(P.p25[y] + 1e-9);
      expect(P.p25[y]).toBeLessThanOrEqual(P.p50[y] + 1e-9);
      expect(P.p50[y]).toBeLessThanOrEqual(P.p75[y] + 1e-9);
      expect(P.p75[y]).toBeLessThanOrEqual(P.p90[y] + 1e-9);
    }
  });
});

describe("stochastic models", () => {
  it("AR(1) inflation respects the clamp and reverts to target", () => {
    const input = { ...couple(), yearsOverride: 400 };
    let sum = 0, n = 0;
    for (let trial = 0; trial < 30; trial++) {
      const path = generateTrialPath(input, { inflation: { kind: "ar1" }, seed: 21 }, trial);
      const infl = path.inflationByYear!;
      for (let y = 1; y < infl.length; y++) {
        expect(infl[y]).toBeGreaterThanOrEqual(-0.02);
        expect(infl[y]).toBeLessThanOrEqual(0.10);
        sum += infl[y]; n++;
      }
    }
    expect(Math.abs(sum / n - 0.021)).toBeLessThan(0.004);
  });

  it("rho = 1 with equal vol gives identical shocks across accounts and spouses", () => {
    const input = couple();
    input.persons[0].returns = { rrsp: 0.05, tfsa: 0.05, unregistered: 0.05, lira: 0.05, dcPension: 0.05 };
    input.persons[1].returns = { rrsp: 0.05, tfsa: 0.05, unregistered: 0.05, lira: 0.05, dcPension: 0.05 };
    const path = generateTrialPath(input, { marketCorrelation: 1, defaultVol: 0.12, seed: 4 }, 0);
    for (const [a, b] of path.returnsByYear!) {
      expect(a.tfsa).toBeCloseTo(a.rrsp!, 12);
      expect(b.rrsp).toBeCloseTo(a.rrsp!, 12);
      expect(b.unregistered).toBeCloseTo(a.rrsp!, 12);
    }
  });

  it("lognormal returns preserve the arithmetic mean (E[gross] = 1 + mu)", () => {
    const input = { ...couple(), yearsOverride: 50 };
    let sum = 0, n = 0;
    for (let trial = 0; trial < 400; trial++) {
      const path = generateTrialPath(input, { defaultVol: 0.15, marketCorrelation: 0.85, seed: 31 }, trial);
      for (const [a] of path.returnsByYear!) { sum += 1 + a.rrsp!; n++; }
    }
    // n = 20,000; SE ≈ 0.15·1.05/√20,000 ≈ 0.0011 → 4·SE ≈ 0.0045
    expect(Math.abs(sum / n - 1.05)).toBeLessThan(0.0045);
  });
});

describe("strategy tuner (§7.4)", () => {
  // Large RRIFs + modest spending: the terminal registered balance is taxed
  // near the top rate at second death, so melting it down at low-bracket
  // rates during life should raise the after-tax real estate.
  const bigRrifCouple = (): HouseholdInput => ({
    startYear: 2026, inflation: 0.021, spendingTargetToday: 70_000,
    persons: [
      { name: "A", birthYear: 1960, retirementAge: 65,
        cpp: { annualAt65Today: 13_000, startAge: 65 }, oas: { startAge: 65, residenceYears: 40 },
        balances: { rrsp: 1_400_000, tfsa: 150_000 },
        returns: { rrsp: 0.05, tfsa: 0.05, unregistered: 0.05 } },
      { name: "B", birthYear: 1962, retirementAge: 65,
        cpp: { annualAt65Today: 9_000, startAge: 65 }, oas: { startAge: 65, residenceYears: 40 },
        balances: { rrsp: 900_000, tfsa: 150_000 },
        returns: { rrsp: 0.05, tfsa: 0.05, unregistered: 0.05 } },
    ],
  });

  it("finds a positive ceiling that beats the naive baseline lexicographically", () => {
    const t = tuneStrategy(bigRrifCouple());
    expect(t.bestCeilingToday).toBeGreaterThan(0);
    const fundedNaive = t.naive.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
    const fundedTuned = t.tuned.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
    expect(fundedTuned).toBeGreaterThanOrEqual(fundedNaive);
    if (!t.naive.failedAnyYear) expect(t.tuned.failedAnyYear).toBe(false);
    expect(t.estateRealGain).toBeGreaterThan(0);
    expect(t.tuned.afterTaxEstateReal).toBeGreaterThan(t.naive.afterTaxEstateReal);
    // Total (lifetime + estate) tax must fall. The direction of LIVING-years
    // tax alone is scenario-dependent: meltdown usually pays more tax earlier,
    // but when the naive baseline's forced RRIF minimums would spike income at
    // high ages (as here, on a $2M+ registered balance), meltdown can lower
    // lifetime tax as well — verified by decomposition when this test was
    // written (naive 1,071,745 vs tuned 1,055,266 lifetime; estate gain wins).
    expect(t.totalTaxSaving).toBeGreaterThan(0);
    // grid covers the search space, sorted, and includes the baseline
    expect(t.grid[0].ceiling).toBe(0);
    expect(t.grid.length).toBeGreaterThanOrEqual(16);
  });

  it("never recommends a ceiling that loses funded years", () => {
    // tight budget: any meltdown must not break spending coverage
    const input = { ...bigRrifCouple(), spendingTargetToday: 118_000 };
    const t = tuneStrategy(input);
    const fundedNaive = t.naive.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
    const fundedTuned = t.tuned.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
    expect(fundedTuned).toBeGreaterThanOrEqual(fundedNaive);
  });
});

describe("performance", () => {
  it("2,000 trials on a realistic couple complete within the regression bound", { timeout: 30_000 }, () => {
    const res = runMonteCarlo(couple(), { trials: 2_000, seed: 7, defaultVol: 0.11 });
    // Local design target ~3s for 2k trials; GitHub-hosted runners are slower
    // and noisier, so CI uses a looser ceiling while still catching catastrophic regressions.
    const limitMs = process.env.CI ? 12_000 : 3_000;
    console.log(`[perf] 2,000 trials: ${Math.round(res.elapsedMs)} ms ` +
      `(successRate ${(res.successRate * 100).toFixed(1)}%, limit ${limitMs}ms)`);
    expect(res.elapsedMs).toBeLessThan(limitMs);
    expect(res.successRate).toBeGreaterThan(0.3);
    expect(res.successRate).toBeLessThanOrEqual(1);
  });
});
