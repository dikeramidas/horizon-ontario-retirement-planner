import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import {
  applyBenefitStarts,
  runBenefitStartGrid,
  currentBenefitStarts,
} from "./benefitStartGrid";

describe("benefitStartGrid", () => {
  it("evaluates 6 CPP×OAS cells via real analyzePlan and picks a recommendation", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const events: string[] = [];
    const res = runBenefitStartGrid(h, {
      quick: true,
      onProgress: (p) => events.push(p.phase),
    });
    expect(res.cells).toHaveLength(6);
    expect(new Set(res.cells.map((c) => `${c.cppStartAge}-${c.oasStartAge}`)).size).toBe(6);
    expect(res.recommended).toBeTruthy();
    expect(res.cells).toContainEqual(res.recommended);
    expect(events.length).toBeGreaterThan(0);

    const applied = applyBenefitStarts(h, res.recommended.cppStartAge, res.recommended.oasStartAge);
    expect(applied.persons[0].cpp?.startAge).toBe(res.recommended.cppStartAge);
    expect(applied.persons[1].oas?.startAge).toBe(res.recommended.oasStartAge);
    expect(currentBenefitStarts(applied)).toEqual({
      cppStartAge: res.recommended.cppStartAge,
      oasStartAge: res.recommended.oasStartAge,
    });
  }, 120_000);
});
