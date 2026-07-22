/**
 * B9 — Deterministic sensitivity (tornado) on key levers.
 */
import type { HouseholdInput } from "../simulate";
import { analyzePlan, type PlanAnalysis } from "./analysis";

export interface SensitivityBar {
  id: string;
  label: string;
  /** Estate real at downside case − base. */
  downDelta: number;
  /** Estate real at upside case − base. */
  upDelta: number;
  downLabel: string;
  upLabel: string;
  baseEstateReal: number;
  downEstateReal: number;
  upEstateReal: number;
}

export interface SensitivityResult {
  baseEstateReal: number;
  baseFunded: boolean;
  bars: SensitivityBar[];
}

function estateOf(a: PlanAnalysis): number {
  return a.primary.afterTaxEstateReal;
}

function clone(h: HouseholdInput): HouseholdInput {
  return structuredClone(h);
}

/**
 * Quick analyzePlan at ± levers around the current household.
 */
export function runSensitivityTornado(
  input: HouseholdInput,
  opts: { quick?: boolean } = { quick: true }
): SensitivityResult {
  const quick = opts.quick !== false;
  const base = analyzePlan(input, { quick });
  const baseE = estateOf(base);

  const bars: SensitivityBar[] = [];

  // Spend ±10%
  {
    const down = clone(input);
    down.spendingTargetToday = Math.max(1000, Math.round(input.spendingTargetToday * 0.9));
    const up = clone(input);
    up.spendingTargetToday = Math.round(input.spendingTargetToday * 1.1);
    const d = analyzePlan(down, { quick });
    const u = analyzePlan(up, { quick });
    bars.push({
      id: "spend",
      label: "Lifestyle spend ±10%",
      downLabel: "−10% spend",
      upLabel: "+10% spend",
      baseEstateReal: baseE,
      downEstateReal: estateOf(d),
      upEstateReal: estateOf(u),
      downDelta: estateOf(d) - baseE,
      upDelta: estateOf(u) - baseE,
    });
  }

  // Returns ±1pp on all account µ
  {
    const shift = (h: HouseholdInput, d: number) => {
      for (const p of h.persons) {
        const r0 = p.returns ?? {};
        p.returns = {
          rrsp: (r0.rrsp ?? 0.05) + d,
          lira: (r0.lira ?? 0.05) + d,
          dcPension: (r0.dcPension ?? 0.05) + d,
          tfsa: (r0.tfsa ?? 0.05) + d,
          unregistered: (r0.unregistered ?? 0.06) + d,
        };
      }
    };
    const down = clone(input);
    shift(down, -0.01);
    const up = clone(input);
    shift(up, 0.01);
    const d = analyzePlan(down, { quick });
    const u = analyzePlan(up, { quick });
    bars.push({
      id: "returns",
      label: "Expected returns ±1 pp",
      downLabel: "−1 pp",
      upLabel: "+1 pp",
      baseEstateReal: baseE,
      downEstateReal: estateOf(d),
      upEstateReal: estateOf(u),
      downDelta: estateOf(d) - baseE,
      upDelta: estateOf(u) - baseE,
    });
  }

  // Retirement +1 / −1 both
  {
    const later = clone(input);
    later.persons = later.persons.map((p) => ({
      ...p,
      retirementAge: Math.min(75, p.retirementAge + 1),
    })) as HouseholdInput["persons"];
    const earlier = clone(input);
    earlier.persons = earlier.persons.map((p) => ({
      ...p,
      retirementAge: Math.max(55, p.retirementAge - 1),
    })) as HouseholdInput["persons"];
    const d = analyzePlan(earlier, { quick });
    const u = analyzePlan(later, { quick });
    bars.push({
      id: "retire",
      label: "Both retire ±1 year",
      downLabel: "1y earlier",
      upLabel: "1y later",
      baseEstateReal: baseE,
      downEstateReal: estateOf(d),
      upEstateReal: estateOf(u),
      downDelta: estateOf(d) - baseE,
      upDelta: estateOf(u) - baseE,
    });
  }

  // Ceiling ±15k (if set)
  {
    const c0 = input.strategy?.topUpCeilingToday ?? 0;
    const down = clone(input);
    down.strategy = { ...(down.strategy ?? {}), topUpCeilingToday: Math.max(0, c0 - 15_000) };
    const up = clone(input);
    up.strategy = { ...(up.strategy ?? {}), topUpCeilingToday: c0 + 15_000 };
    const d = analyzePlan(down, { quick });
    const u = analyzePlan(up, { quick });
    bars.push({
      id: "ceiling",
      label: "Top-up ceiling ±$15k",
      downLabel: "−$15k C",
      upLabel: "+$15k C",
      baseEstateReal: baseE,
      downEstateReal: estateOf(d),
      upEstateReal: estateOf(u),
      downDelta: estateOf(d) - baseE,
      upDelta: estateOf(u) - baseE,
    });
  }

  // Sort by max absolute swing
  bars.sort(
    (a, b) =>
      Math.max(Math.abs(b.downDelta), Math.abs(b.upDelta)) -
      Math.max(Math.abs(a.downDelta), Math.abs(a.upDelta))
  );

  return {
    baseEstateReal: baseE,
    baseFunded: base.funded,
    bars,
  };
}
