import type { PersonInput, SavingsSpec } from "../simulate";

export type SavingsAccount = "rrsp" | "tfsa" | "dc" | "unregistered";

export function readSavingsMode(s: SavingsSpec | undefined): "none" | "fixed" | "pctOfSalary" {
  if (!s || s.type === "none") return "none";
  return s.type;
}

export function readSavingsValue(s: SavingsSpec | undefined): number {
  if (!s || s.type === "none") return 0;
  if (s.type === "fixed") return s.amount;
  return s.pct;
}

/** Build a SavingsSpec from UI mode + value (pct as decimal, e.g. 0.12). */
export function makeSavings(mode: "none" | "fixed" | "pctOfSalary", value: number): SavingsSpec {
  if (mode === "none") return { type: "none" };
  if (mode === "fixed") return { type: "fixed", amount: Math.max(0, value) };
  return { type: "pctOfSalary", pct: Math.max(0, Math.min(0.5, value)) };
}

export function setPersonSavings(
  p: PersonInput,
  account: SavingsAccount,
  mode: "none" | "fixed" | "pctOfSalary",
  value: number
): PersonInput {
  return {
    ...p,
    savings: {
      ...(p.savings ?? {}),
      [account]: makeSavings(mode, value),
    },
  };
}
