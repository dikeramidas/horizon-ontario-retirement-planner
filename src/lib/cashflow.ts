import type { SimulationResult, YearRow } from "../simulate";

export interface AccountCashSlice {
  year: number;
  unregistered: number;
  registered: number;
  lif: number;
  tfsa: number;
  topUp: number;
  salary: number;
  cpp: number;
  oas: number;
  db: number;
  tax: number;
  spending: number;
}

/** Aggregate household cash sources for one year. */
export function yearCashflow(row: YearRow): AccountCashSlice {
  const a = row.persons[0];
  const b = row.persons[1];
  const sumW = (k: keyof typeof a.withdrawals) => a.withdrawals[k] + b.withdrawals[k];
  return {
    year: row.year,
    unregistered: sumW("unregistered"),
    registered: sumW("registered"),
    lif: sumW("lif"),
    tfsa: sumW("tfsa"),
    topUp: sumW("topUp"),
    salary: a.salary + b.salary,
    cpp: a.cpp + b.cpp,
    oas: a.oasGross + b.oasGross,
    db: a.db + b.db,
    tax: row.householdTax,
    spending: row.spendingAchieved,
  };
}

export function cashflowSeries(result: SimulationResult, retirementOnly = true): AccountCashSlice[] {
  return result.rows
    .filter((r) => !retirementOnly || r.solverActive)
    .map(yearCashflow);
}

/** End-of-year investable balances for one spouse (RRSP/LIRA/DC/LIF/TFSA/unreg). */
export function personNetWorth(row: YearRow, personIndex: 0 | 1): number {
  const b = row.persons[personIndex].balancesEnd;
  return b.rrsp + b.lira + b.dcPension + b.lif + b.tfsa + b.unregistered;
}

export function householdNetWorth(row: YearRow): number {
  return personNetWorth(row, 0) + personNetWorth(row, 1);
}
