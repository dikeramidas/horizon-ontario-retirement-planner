/**
 * B3 — Bounded CPP × OAS start-age grid on the expected path.
 * Applies the same start ages to both spouses (keeps the grid small and readable).
 */
import type { HouseholdInput } from "../simulate";
import { analyzePlan, type AnalysisOptions, type PlanAnalysis } from "./analysis";
import { estateTaxOf } from "./estateTax";
import type { ProgressCallback } from "./progress";

export const CPP_START_AGES = [60, 65, 70] as const;
export const OAS_START_AGES = [65, 70] as const;

export interface BenefitStartCell {
  cppStartAge: number;
  oasStartAge: number;
  funded: boolean;
  fundedYears: number;
  firstFailureYear?: number;
  estateReal: number;
  lifetimeTax: number;
  estateTax: number;
  bestCeilingToday: number;
  /** Lexicographic rank key (higher better after sort). */
  scoreLabel: string;
}

export interface BenefitStartGridResult {
  cells: BenefitStartCell[];
  /** Best cell under funded-years → estate → −lifetime tax. */
  recommended: BenefitStartCell;
  /** Current household ages (for highlight). */
  current: { cppStartAge: number; oasStartAge: number };
}

function applyAges(h: HouseholdInput, cppStartAge: number, oasStartAge: number): HouseholdInput {
  const next = structuredClone(h);
  for (const p of next.persons) {
    if (p.cpp) p.cpp = { ...p.cpp, startAge: cppStartAge };
    else p.cpp = { annualAt65Today: 0, startAge: cppStartAge };
    if (p.oas) p.oas = { ...p.oas, startAge: oasStartAge };
    else p.oas = { startAge: oasStartAge, residenceYears: 40 };
  }
  return next;
}

function fundedYears(a: PlanAnalysis): number {
  return a.primary.rows.reduce((n, r) => n + (r.failed ? 0 : 1), 0);
}

function better(a: BenefitStartCell, b: BenefitStartCell): boolean {
  if (a.fundedYears !== b.fundedYears) return a.fundedYears > b.fundedYears;
  if (Math.abs(a.estateReal - b.estateReal) > 1) return a.estateReal > b.estateReal;
  return a.lifetimeTax < b.lifetimeTax - 1;
}

export function currentBenefitStarts(input: HouseholdInput): {
  cppStartAge: number;
  oasStartAge: number;
} {
  return {
    cppStartAge: input.persons[0].cpp?.startAge ?? 65,
    oasStartAge: input.persons[0].oas?.startAge ?? 65,
  };
}

/**
 * Evaluate CPP ∈ {60,65,70} × OAS ∈ {65,70} (6 cells) with quick analyzePlan.
 */
export function runBenefitStartGrid(
  input: HouseholdInput,
  opts: AnalysisOptions & { onProgress?: ProgressCallback } = { quick: true }
): BenefitStartGridResult {
  const cells: BenefitStartCell[] = [];
  const combos: Array<[number, number]> = [];
  for (const cpp of CPP_START_AGES) {
    for (const oas of OAS_START_AGES) combos.push([cpp, oas]);
  }
  let i = 0;
  for (const [cppStartAge, oasStartAge] of combos) {
    i++;
    opts.onProgress?.({
      phase: "benefit-grid",
      fraction: i / combos.length,
      detail: `CPP ${cppStartAge} · OAS ${oasStartAge} (${i}/${combos.length})…`,
    });
    const h = applyAges(input, cppStartAge, oasStartAge);
    const a = analyzePlan(h, { quick: opts.quick ?? true });
    const fy = fundedYears(a);
    cells.push({
      cppStartAge,
      oasStartAge,
      funded: a.funded,
      fundedYears: fy,
      firstFailureYear: a.primary.firstFailureYear,
      estateReal: a.primary.afterTaxEstateReal,
      lifetimeTax: a.primary.lifetimeTax,
      estateTax: estateTaxOf(a.primary),
      bestCeilingToday: a.bestCeilingToday,
      scoreLabel: a.funded
        ? `Funded · estate ${Math.round(a.primary.afterTaxEstateReal / 1000)}k`
        : `Short ${a.primary.firstFailureYear ?? ""}`.trim(),
    });
  }

  let recommended = cells[0];
  for (const c of cells) {
    if (better(c, recommended)) recommended = c;
  }

  opts.onProgress?.({ phase: "done", fraction: 1, detail: "Benefit-start grid ready" });
  return {
    cells,
    recommended,
    current: currentBenefitStarts(input),
  };
}

/** Apply recommended (or chosen) start ages to both spouses. */
export function applyBenefitStarts(
  input: HouseholdInput,
  cppStartAge: number,
  oasStartAge: number
): HouseholdInput {
  return applyAges(input, cppStartAge, oasStartAge);
}
