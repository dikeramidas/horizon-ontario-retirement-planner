import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import {
  analyzePlan,
  prepareForAnalysis,
  prepareMonteCarloRun,
  householdForMonteCarlo,
} from "./analysis";
import { runMonteCarlo } from "../engine-entry";
import { cashflowSeries } from "./cashflow";
import { validateHousehold } from "./validate";

describe("analyzePlan (primary UI path)", () => {
  it("returns funded path, naive vs tuned, tax/estate, and account cash-flow", () => {
    const input = sampleHousehold();
    expect(validateHousehold(input).ok).toBe(true);
    const a = analyzePlan(input, { quick: true });
    expect(a.funded).toBe(true);
    expect(a.primary.lifetimeTax).toBeGreaterThan(0);
    expect(a.primary.afterTaxEstateReal).toBeGreaterThan(0);
    expect(a.naive.lifetimeTax).toBeGreaterThan(0);
    expect(a.bestCeilingToday).toBeGreaterThanOrEqual(0);
    expect(typeof a.totalTaxSaving).toBe("number");
    expect(typeof a.estateRealGain).toBe("number");

    const cf = cashflowSeries(a.primary, true);
    expect(cf.length).toBeGreaterThan(5);
    const draws = cf.reduce(
      (s, r) => s + r.registered + r.unregistered + r.tfsa + r.lif + r.topUp,
      0
    );
    expect(draws).toBeGreaterThan(0);
  });

  it("prepareForAnalysis clones and forces thorough solver", () => {
    const input = sampleHousehold();
    input.solverQuality = "fast";
    const p = prepareForAnalysis(input);
    expect(p.solverQuality).toBe("thorough");
    expect(p.spendingTargetToday).toBe(input.spendingTargetToday);
    p.spendingTargetToday = 1;
    expect(input.spendingTargetToday).not.toBe(1);
  });

  it("throws on invalid household", () => {
    const bad = sampleHousehold();
    bad.spendingTargetToday = 0;
    expect(() => analyzePlan(bad)).toThrow(/spending/i);
  });

  it("prepareMonteCarloRun pins MC household to tuned ceiling (not pre-tune input)", () => {
    const input = sampleHousehold();
    // Force a stale / no-tune path like the UI before first analyze finishes syncing state
    input.strategy = { topUpCeilingToday: 0 };
    const prep = prepareMonteCarloRun(input, { hasTune: false, stale: true }, { quick: true });
    expect(prep.analysis).not.toBeNull();
    expect(prep.ceiling).toBe(prep.analysis!.bestCeilingToday);
    expect(prep.household.strategy?.topUpCeilingToday).toBe(prep.ceiling);
    // Must not leave C=0 when the tuner found a positive ceiling (sample couple does)
    if (prep.ceiling > 0) {
      expect(prep.household.strategy?.topUpCeilingToday).toBeGreaterThan(0);
      expect(prep.household.strategy?.topUpCeilingToday).not.toBe(0);
    }
    expect(prep.household.solverQuality).toBe("fast");

    // Fresh path: still use displayed ceiling, not a stale zero on a mutated clone
    const fresh = prepareMonteCarloRun(
      { ...input, strategy: { topUpCeilingToday: 999 } },
      { hasTune: true, stale: false, displayedCeiling: prep.ceiling },
      { quick: true }
    );
    expect(fresh.analysis).toBeNull();
    expect(fresh.household.strategy?.topUpCeilingToday).toBe(prep.ceiling);
    // MC must carry L4 share from analysis, not default 0
    expect(prep.tfsaFirstShare).toBe(prep.analysis!.tfsaTune!.bestShare);
    expect(prep.household.strategy?.tfsaFirstShare).toBe(prep.tfsaFirstShare);
    expect(prep.household.strategy?.tfsaLevel).toBe("l4");

    const mc = runMonteCarlo(prep.household, {
      trials: 3,
      seed: 11,
      defaultVol: 0.05,
      inflation: { kind: "fixed" },
    });
    expect(mc.trials).toBe(3);
    expect(mc.estateReal.p50).toBeGreaterThan(0);
  });

  it("householdForMonteCarlo is pure merge of ceiling + fast solver", () => {
    const h = householdForMonteCarlo(sampleHousehold(), 77_000);
    expect(h.strategy?.topUpCeilingToday).toBe(77_000);
    expect(h.solverQuality).toBe("fast");
  });
});

