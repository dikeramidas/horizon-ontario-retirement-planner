/**
 * Longevity scenarios — compare baseline (both live) vs first-death at chosen ages.
 * Uses the household’s current strategy pins (C/bands/TFSA); does not re-tune per row.
 */
import {
  simulate,
  type HouseholdInput,
  type SimulationResult,
} from "../simulate";
import type { ProgressCallback } from "./progress";

/** Default death ages explored for each spouse (attained age at year-end death). */
export const DEFAULT_LONGEVITY_AGES = [75, 85, 95] as const;

export interface LongevityScenarioOptions {
  /** Ages at which to model first death for each spouse. Default [75, 85, 95]. */
  deathAges?: number[];
  /** Survivor household spend fraction (default from input.survivorship or 0.7). */
  survivorSpendFrac?: number;
  onProgress?: ProgressCallback;
}

export interface LongevityScenarioRow {
  id: string;
  label: string;
  kind: "baseline" | "first_death";
  /** Who dies first (first_death only). */
  firstDeathPerson?: 0 | 1;
  deathAge?: number;
  firstDeathYear?: number;
  /** True when the age/year cannot be applied within this plan. */
  skipped?: boolean;
  skipReason?: string;
  funded?: boolean;
  firstFailureYear?: number;
  fundedYears?: number;
  lifetimeTax?: number;
  estateReal?: number;
  /** Calendar years in the plan after the death year (survivor continuation). */
  survivorYears?: number;
}

export interface LongevityScenarioResult {
  personNames: [string, string];
  survivorSpendFrac: number;
  deathAges: number[];
  startYear: number;
  planEndYear: number;
  rows: LongevityScenarioRow[];
}

export function planStartYear(input: HouseholdInput): number {
  return input.startYear ?? 2026;
}

/** Last calendar year included in the projection (inclusive). */
export function planEndYear(input: HouseholdInput): number {
  const start = planStartYear(input);
  if (input.yearsOverride != null && input.yearsOverride > 0) {
    return start + input.yearsOverride - 1;
  }
  const youngerBirth = Math.max(input.persons[0].birthYear, input.persons[1].birthYear);
  const horizon = input.horizonAgeYoungerSpouse ?? 95;
  return youngerBirth + horizon;
}

/** Age attained Dec 31 of calendar year = year − birthYear (engine convention). */
export function deathYearFromAge(birthYear: number, deathAge: number): number {
  return birthYear + deathAge;
}

export function ageAtYear(birthYear: number, year: number): number {
  return year - birthYear;
}

/**
 * Whether a first-death at deathAge for person is in-range for this plan.
 * Death is modeled at end of year; survivor needs at least the death year on path.
 */
export function validateDeathAge(
  input: HouseholdInput,
  person: 0 | 1,
  deathAge: number
): { ok: true; deathYear: number } | { ok: false; reason: string } {
  if (!Number.isFinite(deathAge) || deathAge < 50 || deathAge > 120) {
    return { ok: false, reason: "Death age must be between 50 and 120." };
  }
  const birth = input.persons[person].birthYear;
  const deathYear = deathYearFromAge(birth, deathAge);
  const start = planStartYear(input);
  const end = planEndYear(input);
  const ageAtStart = ageAtYear(birth, start);
  if (deathAge < ageAtStart) {
    return {
      ok: false,
      reason: `Already age ${ageAtStart} at plan start (death age ${deathAge} is in the past).`,
    };
  }
  if (deathYear < start) {
    return { ok: false, reason: `Death year ${deathYear} is before plan start ${start}.` };
  }
  if (deathYear > end) {
    return {
      ok: false,
      reason: `Death year ${deathYear} is after plan end ${end} (no effect within horizon).`,
    };
  }
  return { ok: true, deathYear };
}

export function householdWithFirstDeath(
  base: HouseholdInput,
  person: 0 | 1,
  deathYear: number,
  survivorSpendFrac: number
): HouseholdInput {
  const prepared = structuredClone(base);
  prepared.survivorship = {
    enabled: true,
    firstDeathPerson: person,
    firstDeathYear: deathYear,
    survivorSpendFrac,
  };
  // Longevity grid should not re-layer stochastic path overrides
  delete prepared.path;
  prepared.solverQuality = prepared.solverQuality ?? "thorough";
  return prepared;
}

export function householdBothLive(base: HouseholdInput): HouseholdInput {
  const prepared = structuredClone(base);
  if (prepared.survivorship) {
    prepared.survivorship = { ...prepared.survivorship, enabled: false };
  }
  delete prepared.path;
  prepared.solverQuality = prepared.solverQuality ?? "thorough";
  return prepared;
}

function metricsFromSim(
  res: SimulationResult,
  deathYear?: number
): Pick<
  LongevityScenarioRow,
  | "funded"
  | "firstFailureYear"
  | "fundedYears"
  | "lifetimeTax"
  | "estateReal"
  | "survivorYears"
> {
  const fundedYears = res.rows.reduce((a, r) => a + (r.failed ? 0 : 1), 0);
  let survivorYears: number | undefined;
  if (deathYear != null) {
    survivorYears = res.rows.filter((r) => r.year > deathYear).length;
  }
  return {
    funded: !res.failedAnyYear,
    firstFailureYear: res.firstFailureYear,
    fundedYears,
    lifetimeTax: res.lifetimeTax,
    estateReal: res.afterTaxEstateReal,
    survivorYears,
  };
}

/**
 * Run baseline + each spouse × death age. Pins strategy from `base` (no re-tune).
 */
export function runLongevityScenarios(
  base: HouseholdInput,
  opts: LongevityScenarioOptions = {}
): LongevityScenarioResult {
  const deathAges = [...(opts.deathAges ?? DEFAULT_LONGEVITY_AGES)].sort((a, b) => a - b);
  const survivorSpendFrac =
    opts.survivorSpendFrac ??
    base.survivorship?.survivorSpendFrac ??
    0.7;
  const names: [string, string] = [
    base.persons[0].name || "Spouse A",
    base.persons[1].name || "Spouse B",
  ];
  const startYear = planStartYear(base);
  const endYear = planEndYear(base);
  const rows: LongevityScenarioRow[] = [];
  const report = opts.onProgress;

  // Total work units: 1 baseline + ages × 2 persons
  const total = 1 + deathAges.length * 2;
  let done = 0;
  const tick = (detail: string) => {
    done += 1;
    report?.({
      phase: "longevity",
      fraction: done / total,
      detail,
    });
  };

  // Baseline
  {
    const h = householdBothLive(base);
    const res = simulate(h);
    rows.push({
      id: "baseline",
      label: "Both live to plan end",
      kind: "baseline",
      ...metricsFromSim(res),
    });
    tick("Baseline (both live)…");
  }

  for (const person of [0, 1] as const) {
    const name = names[person];
    for (const deathAge of deathAges) {
      const id = `p${person}-age${deathAge}`;
      const v = validateDeathAge(base, person, deathAge);
      if (!v.ok) {
        rows.push({
          id,
          label: `${name} dies at ${deathAge}`,
          kind: "first_death",
          firstDeathPerson: person,
          deathAge,
          skipped: true,
          skipReason: v.reason,
        });
        tick(`Skip ${name} @ ${deathAge}…`);
        continue;
      }
      const h = householdWithFirstDeath(base, person, v.deathYear, survivorSpendFrac);
      const res = simulate(h);
      rows.push({
        id,
        label: `${name} dies at ${deathAge}`,
        kind: "first_death",
        firstDeathPerson: person,
        deathAge,
        firstDeathYear: v.deathYear,
        ...metricsFromSim(res, v.deathYear),
      });
      tick(`${name} dies at ${deathAge}…`);
    }
  }

  report?.({ phase: "done", fraction: 1, detail: "Longevity scenarios ready" });

  return {
    personNames: names,
    survivorSpendFrac,
    deathAges,
    startYear,
    planEndYear: endYear,
    rows,
  };
}

/** Build survivorship block to apply a scenario row onto household inputs. */
export function survivorshipFromRow(
  row: LongevityScenarioRow,
  survivorSpendFrac: number
): HouseholdInput["survivorship"] | undefined {
  if (row.kind === "baseline" || row.skipped) {
    return {
      enabled: false,
      firstDeathPerson: 0,
      firstDeathYear: 0,
      survivorSpendFrac,
    };
  }
  if (row.firstDeathPerson == null || row.firstDeathYear == null) return undefined;
  return {
    enabled: true,
    firstDeathPerson: row.firstDeathPerson,
    firstDeathYear: row.firstDeathYear,
    survivorSpendFrac,
  };
}
