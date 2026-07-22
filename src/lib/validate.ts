import type { HouseholdInput, PersonInput } from "../simulate";

export type IssueLevel = "error" | "warning";

export interface ValidationIssue {
  level: IssueLevel;
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean; // false only when errors block analysis
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function personIssues(p: PersonInput, label: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const year = new Date().getFullYear();
  if (!p.name?.trim()) {
    out.push({ level: "warning", field: `${label}.name`, message: `${label}: add a name so results are easier to read.` });
  }
  if (p.birthYear < 1930 || p.birthYear > year - 18) {
    out.push({
      level: "error",
      field: `${label}.birthYear`,
      message: `${label}: birth year looks wrong (${p.birthYear}).`,
    });
  }
  if (p.retirementAge < 45 || p.retirementAge > 75) {
    out.push({
      level: "error",
      field: `${label}.retirementAge`,
      message: `${label}: retirement age should be between 45 and 75.`,
    });
  }
  if ((p.salaryToday ?? 0) < 0) {
    out.push({ level: "error", field: `${label}.salary`, message: `${label}: salary cannot be negative.` });
  }
  const unreg = p.balances?.unregistered;
  if (unreg && unreg.acb > unreg.balance + 1) {
    out.push({
      level: "error",
      field: `${label}.acb`,
      message: `${label}: cost base (ACB) cannot exceed the unregistered balance.`,
    });
  }
  if (p.cpp) {
    if (p.cpp.startAge < 60 || p.cpp.startAge > 70) {
      out.push({
        level: "error",
        field: `${label}.cppStart`,
        message: `${label}: CPP start age must be 60–70.`,
      });
    }
  }
  if (p.oas) {
    if (p.oas.startAge < 65 || p.oas.startAge > 70) {
      out.push({
        level: "error",
        field: `${label}.oasStart`,
        message: `${label}: OAS start age must be 65–70.`,
      });
    }
    if (p.oas.residenceYears < 0 || p.oas.residenceYears > 40) {
      out.push({
        level: "warning",
        field: `${label}.oasRes`,
        message: `${label}: OAS is prorated by years in Canada (0–40).`,
      });
    }
  }
  const rets = p.returns ?? {};
  for (const [k, v] of Object.entries(rets)) {
    if (v != null && (v < -0.5 || v > 0.4)) {
      out.push({
        level: "warning",
        field: `${label}.returns.${k}`,
        message: `${label}: ${k} expected return ${v} looks extreme — check you entered a decimal (e.g. 0.05 for 5%).`,
      });
    }
  }
  const totalBal =
    (p.balances?.rrsp ?? 0) +
    (p.balances?.lira ?? 0) +
    (p.balances?.dcPension ?? 0) +
    (p.balances?.tfsa ?? 0) +
    (p.balances?.unregistered?.balance ?? 0);
  if (totalBal <= 0 && (p.salaryToday ?? 0) <= 0 && !p.db) {
    out.push({
      level: "warning",
      field: `${label}.balances`,
      message: `${label}: no balances, salary, or pension — this person adds little to the plan.`,
    });
  }
  return out;
}

/** Validate household planning inputs before calling the engine. */
export function validateHousehold(input: HouseholdInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!(input.spendingTargetToday > 0)) {
    issues.push({
      level: "error",
      field: "spendingTargetToday",
      message: "Annual spending target must be greater than zero.",
    });
  }
  if (input.spendingTargetToday > 500_000) {
    issues.push({
      level: "warning",
      field: "spendingTargetToday",
      message: "Spending target is very high — confirm it is annual lifestyle cost in today's dollars.",
    });
  }
  const infl = input.inflation ?? 0.021;
  if (infl < -0.02 || infl > 0.1) {
    issues.push({
      level: "error",
      field: "inflation",
      message: "Inflation should be between −2% and 10% (as a decimal, e.g. 0.021).",
    });
  }
  const horizon = input.horizonAgeYoungerSpouse ?? 95;
  if (horizon < 80 || horizon > 105) {
    issues.push({
      level: "error",
      field: "horizon",
      message: "Planning horizon age should be between 80 and 105.",
    });
  }
  if (!input.persons?.[0] || !input.persons?.[1]) {
    issues.push({ level: "error", field: "persons", message: "Two spouses are required." });
  } else {
    issues.push(...personIssues(input.persons[0], input.persons[0].name || "Spouse A"));
    issues.push(...personIssues(input.persons[1], input.persons[1].name || "Spouse B"));
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

/** True when the plan is safe to run through the engine. */
export function canAnalyze(input: HouseholdInput): boolean {
  return validateHousehold(input).ok;
}
