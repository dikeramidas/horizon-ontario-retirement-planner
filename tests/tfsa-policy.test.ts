/**
 * L1–L4 TFSA withdrawal policy — drives real simulate/analyzePlan.
 * Fixtures are built so TFSA actually moves (not theater assertions).
 */
import { describe, it, expect } from "vitest";
import { simulate, type HouseholdInput, type PersonInput } from "../src/simulate";
import { analyzePlan, householdForMonteCarlo, prepareMonteCarloRun } from "../src/lib/analysis";
import { sampleHousehold } from "../src/lib/sampleHousehold";
import { allocateDiscretionaryW, personIncomeTargets } from "../src/lib/tfsaPolicy";
import { tuneTfsaShare } from "../src/lib/tfsaTune";
import { runMonteCarlo } from "../src/mc";

const zeroR = { rrsp: 0, lira: 0, dcPension: 0, tfsa: 0, unregistered: 0 };

function person(over: Partial<PersonInput>): PersonInput {
  return {
    name: "p",
    birthYear: 1960,
    retirementAge: 65,
    returns: zeroR,
    reinvestRrspRefund: false,
    ...over,
  };
}

/**
 * Conversion year (age 65): no RRIF min yet, no CPP/OAS.
 * High spending + low C ⇒ L1 must use TFSA after filling taxable room under C.
 * Legacy (TFSA-last) drains RRSP first and can leave TFSA near 0 for spending.
 */
function spendHeavyLowCeiling(
  level: "legacy" | "l1" | "l2" | "l3" | "l4",
  strategyExtra: Record<string, unknown> = {}
): HouseholdInput {
  return {
    startYear: 2026,
    inflation: 0,
    yearsOverride: 3,
    spendingTargetToday: 120_000,
    strategy: {
      topUpCeilingToday: 25_000,
      tfsaLevel: level,
      tfsaReserveYears: 0,
      tfsaFirstShare: 0,
      ...strategyExtra,
    },
    persons: [
      person({
        name: "A",
        birthYear: 1961, // age 65 in 2026 — conversion year, no min yet
        retirementAge: 65,
        balances: { rrsp: 400_000, tfsa: 250_000 },
      }),
      person({
        name: "B",
        birthYear: 1961,
        retirementAge: 65,
        balances: { rrsp: 350_000, tfsa: 200_000 },
      }),
    ],
  };
}

function sumTfsa(res: ReturnType<typeof simulate>): number {
  let t = 0;
  for (const row of res.rows) {
    if (!row.solverActive) continue;
    for (const p of row.persons) t += p.withdrawals.tfsa;
  }
  return t;
}

function sumDiscReg(res: ReturnType<typeof simulate>): number {
  let t = 0;
  for (const row of res.rows) {
    if (!row.solverActive) continue;
    for (const p of row.persons) {
      // discretionary registered (exclude forced min which is inside registered total)
      // registered field includes min; for conversion year min=0 so full amount is discretionary
      t += Math.max(0, p.withdrawals.registered - p.rrifMin) + p.withdrawals.topUp;
    }
  }
  return t;
}

describe("L1 taxable-to-C then TFSA", () => {
  it("unit: under cap allocates taxable first then TFSA", () => {
    const alloc = allocateDiscretionaryW(100_000, {
      level: "l1",
      incomeCeiling: 50_000,
      oasThreshold: 95_000,
      baseTaxable: [30_000, 30_000],
      caps: [
        { unreg: 0, reg: 80_000, lif: 0, tfsa: 100_000 },
        { unreg: 0, reg: 80_000, lif: 0, tfsa: 100_000 },
      ],
      gainFrac: [0, 0],
      tfsaReserveTotal: 0,
      tfsaFirstShare: 0,
    });
    const taxDisc = alloc.tR[0] + alloc.tR[1] + alloc.tU[0] + alloc.tU[1] + alloc.tL[0] + alloc.tL[1];
    const tfsa = alloc.tT[0] + alloc.tT[1];
    expect(taxDisc).toBeLessThanOrEqual(40_000 + 1);
    expect(tfsa).toBeGreaterThan(50_000);
    expect(taxDisc + tfsa).toBeCloseTo(100_000, 0);
  });

  it("simulate: L1 draws TFSA and more than legacy when C is tight", () => {
    const legacy = simulate({ ...spendHeavyLowCeiling("legacy"), solverQuality: "thorough" });
    const l1 = simulate({ ...spendHeavyLowCeiling("l1"), solverQuality: "thorough" });
    expect(legacy.failedAnyYear).toBe(false);
    expect(l1.failedAnyYear).toBe(false);

    const legacyTfsa = sumTfsa(legacy);
    const l1Tfsa = sumTfsa(l1);
    const l1Reg = sumDiscReg(l1);

    expect(l1Tfsa).toBeGreaterThan(1_000);
    expect(l1Tfsa).toBeGreaterThan(legacyTfsa + 1_000);
    // Discretionary registered should stay near household room under C (25k ceiling, base~0)
    // across years some top-up may add, but first years' spending path should not dump all reg
    expect(l1Reg).toBeGreaterThan(0);

    // Spot a solver year: TFSA used and taxable income not wildly above C without TFSA help
    const row = l1.rows.find((r) => r.solverActive && r.persons.some((p) => p.withdrawals.tfsa > 100));
    expect(row).toBeTruthy();
    const discTax =
      row!.persons[0].withdrawals.registered -
      row!.persons[0].rrifMin +
      row!.persons[1].withdrawals.registered -
      row!.persons[1].rrifMin +
      row!.persons[0].withdrawals.unregistered +
      row!.persons[1].withdrawals.unregistered +
      row!.persons[0].withdrawals.lif -
      row!.persons[0].lifMin +
      row!.persons[1].withdrawals.lif -
      row!.persons[1].lifMin;
    // With C=25k and two people, under-cap taxable discretionary is limited before TFSA
    expect(discTax).toBeLessThan(80_000);
  });

  it("conservation holds under L1", () => {
    const res = simulate({ ...spendHeavyLowCeiling("l1"), solverQuality: "thorough" });
    for (const row of res.rows) {
      if (row.solverActive) {
        expect(Math.abs(row.conservationResidual)).toBeLessThanOrEqual(1.01);
      }
    }
  });
});

describe("L2 OAS-aware cap", () => {
  it("personIncomeTargets uses min(C, OAS) for l2", () => {
    const [c] = personIncomeTargets("l2", 120_000, 95_323);
    expect(c).toBeCloseTo(95_323, 0);
    const [c2] = personIncomeTargets("l2", 40_000, 95_323);
    expect(c2).toBeCloseTo(40_000, 0);
  });

  it("simulate: L2 uses more TFSA than legacy when high C but OAS caps taxable", () => {
    // High C (200k) would allow lots of taxable under L1; L2 caps at OAS (~95k).
    // Large forced-ish income not required: spend >> 2×OAS taxable room so L2 must use TFSA.
    // Legacy (TFSA-last) still prefers RRSP for almost all spending.
    const h: HouseholdInput = {
      startYear: 2026,
      inflation: 0,
      yearsOverride: 3,
      spendingTargetToday: 220_000,
      strategy: {
        topUpCeilingToday: 200_000,
        tfsaLevel: "l2",
        tfsaReserveYears: 0,
        tfsaFirstShare: 0,
      },
      persons: [
        person({
          name: "A",
          birthYear: 1961,
          retirementAge: 65,
          balances: { rrsp: 900_000, tfsa: 400_000 },
        }),
        person({
          name: "B",
          birthYear: 1961,
          retirementAge: 65,
          balances: { rrsp: 800_000, tfsa: 350_000 },
        }),
      ],
    };

    const l2 = simulate({ ...h, solverQuality: "thorough" });
    const legacy = simulate({
      ...h,
      strategy: { ...h.strategy!, tfsaLevel: "legacy" },
      solverQuality: "thorough",
    });
    expect(l2.failedAnyYear).toBe(false);
    expect(legacy.failedAnyYear).toBe(false);

    const l2Tfsa = sumTfsa(l2);
    const legTfsa = sumTfsa(legacy);
    expect(l2Tfsa).toBeGreaterThan(1_000);
    expect(l2Tfsa).toBeGreaterThan(legTfsa + 1_000);
  });
});

describe("L3 TFSA reserve", () => {
  it("caps TFSA when share would draw it but reserve binds and taxable headroom remains", () => {
    // L4 first-share=1 would take all from TFSA; with reserve, only excess above reserve
    // then taxable under cap fills the rest.
    const withReserve = allocateDiscretionaryW(50_000, {
      level: "l4",
      incomeCeiling: 100_000,
      oasThreshold: 200_000,
      baseTaxable: [20_000, 20_000],
      caps: [
        { unreg: 0, reg: 100_000, lif: 0, tfsa: 100_000 },
        { unreg: 0, reg: 100_000, lif: 0, tfsa: 100_000 },
      ],
      gainFrac: [0, 0],
      tfsaReserveTotal: 180_000, // only 20k TFSA free
      tfsaFirstShare: 1,
    });
    const noReserve = allocateDiscretionaryW(50_000, {
      level: "l4",
      incomeCeiling: 100_000,
      oasThreshold: 200_000,
      baseTaxable: [20_000, 20_000],
      caps: [
        { unreg: 0, reg: 100_000, lif: 0, tfsa: 100_000 },
        { unreg: 0, reg: 100_000, lif: 0, tfsa: 100_000 },
      ],
      gainFrac: [0, 0],
      tfsaReserveTotal: 0,
      tfsaFirstShare: 1,
    });

    const tfsaR = withReserve.tT[0] + withReserve.tT[1];
    const regR = withReserve.tR[0] + withReserve.tR[1];
    const tfsaN = noReserve.tT[0] + noReserve.tT[1];

    expect(tfsaN).toBeCloseTo(50_000, 0); // no reserve → all TFSA first
    expect(tfsaR).toBeLessThanOrEqual(20_000 + 1); // only above reserve
    expect(tfsaR).toBeGreaterThan(0);
    expect(regR).toBeGreaterThan(20_000); // taxable headroom used for remainder
  });

  it("breaches reserve when needed to fund spending", () => {
    const need = allocateDiscretionaryW(150_000, {
      level: "l3",
      incomeCeiling: 0,
      oasThreshold: 0,
      baseTaxable: [50_000, 50_000],
      caps: [
        { unreg: 0, reg: 0, lif: 0, tfsa: 100_000 },
        { unreg: 0, reg: 0, lif: 0, tfsa: 100_000 },
      ],
      gainFrac: [0, 0],
      tfsaReserveTotal: 150_000,
      tfsaFirstShare: 0,
    });
    expect(need.tT[0] + need.tT[1]).toBeCloseTo(150_000, 0);
  });
});

describe("L4 multi-year TFSA share search", () => {
  it("tuneTfsaShare finds a share and L4 ≥ L3 on lex objective", () => {
    const base = sampleHousehold();
    base.strategy = {
      ...(base.strategy ?? {}),
      tfsaLevel: "l4",
      tfsaReserveYears: 2,
      topUpCeilingToday: base.strategy?.topUpCeilingToday ?? 85_000,
    };
    const tuned = tuneTfsaShare(base);
    expect(tuned.grid.length).toBeGreaterThanOrEqual(2);
    expect(tuned.bestShare).toBeGreaterThanOrEqual(0);
    expect(tuned.bestShare).toBeLessThanOrEqual(1);

    const fund = (r: typeof tuned.best) => r.rows.reduce((a, row) => a + (row.failed ? 0 : 1), 0);
    const fBest = fund(tuned.best);
    const fL3 = fund(tuned.l3Baseline);
    expect(fBest).toBeGreaterThanOrEqual(fL3);
    if (fBest === fL3) {
      expect(tuned.best.afterTaxEstateReal + 1).toBeGreaterThanOrEqual(tuned.l3Baseline.afterTaxEstateReal);
    }
  });

  it("analyzePlan with default l4 returns tfsaTune and funded sample", () => {
    const a = analyzePlan(sampleHousehold(), { quick: true });
    expect(a.funded).toBe(true);
    expect(a.tfsaTune).toBeDefined();
    expect(a.tfsaTune!.bestShare).toBeGreaterThanOrEqual(0);
    expect(a.primary.lifetimeTax).toBeGreaterThan(0);
  });

  it("prepareMonteCarloRun pins tuned tfsaFirstShare into MC household", () => {
    const input = sampleHousehold();
    // Force fresh analysis path
    const prep = prepareMonteCarloRun(input, { hasTune: false, stale: true }, { quick: true });
    expect(prep.analysis?.tfsaTune).toBeDefined();
    const share = prep.analysis!.tfsaTune!.bestShare;
    expect(prep.household.strategy?.tfsaFirstShare).toBe(share);
    expect(prep.household.strategy?.topUpCeilingToday).toBe(prep.ceiling);
    expect(prep.household.strategy?.tfsaLevel).toBe("l4");

    // Fresh path with state already carrying share
    const pinned = householdForMonteCarlo(
      {
        ...input,
        strategy: {
          ...(input.strategy ?? {}),
          topUpCeilingToday: prep.ceiling,
          tfsaLevel: "l4",
          tfsaFirstShare: share,
          tfsaReserveYears: 2,
        },
      },
      { topUpCeilingToday: prep.ceiling, tfsaFirstShare: share }
    );
    expect(pinned.strategy?.tfsaFirstShare).toBe(share);

    // Smoke: MC runs with pinned policy
    const mc = runMonteCarlo(pinned, { trials: 3, seed: 1, defaultVol: 0.05 });
    expect(mc.trials).toBe(3);
  });
});

describe("level comparison dump (sample couple)", () => {
  it("logs legacy→l4 tax/estate/TFSA path metrics", () => {
    const base = sampleHousehold();
    const lines: string[] = [];
    for (const level of ["legacy", "l1", "l2", "l3", "l4"] as const) {
      const r = simulate({
        ...base,
        solverQuality: "thorough",
        strategy: {
          ...(base.strategy ?? {}),
          tfsaLevel: level,
          tfsaReserveYears: 2,
          tfsaFirstShare: level === "l4" ? 0.2 : 0,
          topUpCeilingToday: base.strategy?.topUpCeilingToday ?? 85_000,
        },
      });
      lines.push(
        `${level}: failed=${r.failedAnyYear} tax=${Math.round(r.lifetimeTax)} estateReal=${Math.round(r.afterTaxEstateReal)} tfsaW=${Math.round(sumTfsa(r))} regW=${Math.round(sumDiscReg(r))}`
      );
    }
    const a = analyzePlan(sampleHousehold(), { quick: true });
    lines.push(
      `analyzePlan: share=${a.tfsaTune?.bestShare} estate=${Math.round(a.primary.afterTaxEstateReal)} funded=${a.funded}`
    );
    // eslint-disable-next-line no-console
    console.log("[tfsa-levels]\n" + lines.join("\n"));
    expect(lines.length).toBe(6);
  });
});

describe("allocate pure invariants", () => {
  it("never allocates more than W or caps", () => {
    const W = 75_000;
    const caps = [
      { unreg: 10_000, reg: 40_000, lif: 5_000, tfsa: 30_000 },
      { unreg: 10_000, reg: 40_000, lif: 5_000, tfsa: 30_000 },
    ];
    for (const level of ["l1", "l2", "l3", "l4"] as const) {
      const a = allocateDiscretionaryW(W, {
        level,
        incomeCeiling: 45_000,
        oasThreshold: 90_000,
        baseTaxable: [25_000, 20_000],
        caps,
        gainFrac: [0.3, 0.2],
        tfsaReserveTotal: level === "l3" || level === "l4" ? 20_000 : 0,
        tfsaFirstShare: level === "l4" ? 0.4 : 0,
      });
      const sum =
        a.tU[0] + a.tU[1] + a.tR[0] + a.tR[1] + a.tL[0] + a.tL[1] + a.tT[0] + a.tT[1];
      expect(sum).toBeLessThanOrEqual(W + 1e-6);
      expect(a.tU[0]).toBeLessThanOrEqual(caps[0].unreg + 1e-6);
      expect(a.tT[0] + a.tT[1]).toBeLessThanOrEqual(60_000 + 1e-6);
    }
  });
});
