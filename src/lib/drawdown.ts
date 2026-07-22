/**
 * Drawdown view-models projected from engine YearRow data.
 * Opening balances for year t = prior year balancesEnd (or zero on first row).
 * Withdrawals and ending balances are read directly from the engine — no re-solve.
 */
import type { PersonYear, SimulationResult, YearRow } from "../simulate";

export type FundingAccount = "registered" | "lif" | "tfsa" | "unregistered" | "topUp";

export interface PersonAccountBalances {
  rrsp: number;
  lira: number;
  dcPension: number;
  lif: number;
  tfsa: number;
  unregistered: number;
  /** Registered-like total used for drawdown tracking (RRSP/RRIF + LIRA + DC still locked). */
  registeredPool: number;
  total: number;
}

export interface PersonDrawdownYear {
  personIndex: 0 | 1;
  name: string;
  ageDec31: number;
  working: boolean;
  /** Engine withdrawals this year (funding sources). */
  withdrawals: {
    unregistered: number;
    registered: number; // includes RRIF min + discretionary
    lif: number; // includes LIF min + discretionary
    tfsa: number;
    topUp: number;
    /** Sum of all withdrawal channels. */
    total: number;
  };
  /** Forced mins (subset of registered/lif withdrawals). */
  forced: { rrifMin: number; lifMin: number };
  income: { salary: number; cpp: number; oas: number; db: number };
  tax: { federal: number; ontario: number; clawback: number; total: number };
  /** Start-of-year balances (prior year end; 0 before first simulated year). */
  balancesOpen: PersonAccountBalances;
  /** Year-end balances from engine. */
  balancesEnd: PersonAccountBalances;
}

export interface DrawdownYear {
  year: number;
  cpiIndex: number;
  solverActive: boolean;
  spendingTarget: number;
  spendingAchieved: number;
  householdTax: number;
  persons: [PersonDrawdownYear, PersonDrawdownYear];
  /** Household-level withdrawal totals by account. */
  householdWithdrawals: PersonDrawdownYear["withdrawals"];
  householdBalancesEnd: PersonAccountBalances;
}

function balFromEnd(b: PersonYear["balancesEnd"]): PersonAccountBalances {
  const registeredPool = b.rrsp + b.lira + b.dcPension;
  const total = registeredPool + b.lif + b.tfsa + b.unregistered;
  return {
    rrsp: b.rrsp,
    lira: b.lira,
    dcPension: b.dcPension,
    lif: b.lif,
    tfsa: b.tfsa,
    unregistered: b.unregistered,
    registeredPool,
    total,
  };
}

function zeroBal(): PersonAccountBalances {
  return {
    rrsp: 0, lira: 0, dcPension: 0, lif: 0, tfsa: 0, unregistered: 0,
    registeredPool: 0, total: 0,
  };
}

function sumBal(a: PersonAccountBalances, b: PersonAccountBalances): PersonAccountBalances {
  return {
    rrsp: a.rrsp + b.rrsp,
    lira: a.lira + b.lira,
    dcPension: a.dcPension + b.dcPension,
    lif: a.lif + b.lif,
    tfsa: a.tfsa + b.tfsa,
    unregistered: a.unregistered + b.unregistered,
    registeredPool: a.registeredPool + b.registeredPool,
    total: a.total + b.total,
  };
}

function mapPerson(
  py: PersonYear,
  personIndex: 0 | 1,
  name: string,
  open: PersonAccountBalances
): PersonDrawdownYear {
  const w = py.withdrawals;
  const total = w.unregistered + w.registered + w.lif + w.tfsa + w.topUp;
  return {
    personIndex,
    name,
    ageDec31: py.ageDec31,
    working: py.working,
    withdrawals: {
      unregistered: w.unregistered,
      registered: w.registered,
      lif: w.lif,
      tfsa: w.tfsa,
      topUp: w.topUp,
      total,
    },
    forced: { rrifMin: py.rrifMin, lifMin: py.lifMin },
    income: { salary: py.salary, cpp: py.cpp, oas: py.oasGross, db: py.db },
    tax: { ...py.tax },
    balancesOpen: open,
    balancesEnd: balFromEnd(py.balancesEnd),
  };
}

/**
 * Full drawdown ledger for every simulated year.
 * Opening balances = previous row's balancesEnd for that person (documented derivation).
 */
export function buildDrawdownLedger(
  result: SimulationResult,
  personNames: [string, string] = ["Spouse A", "Spouse B"],
  opts: { retirementOnly?: boolean } = {}
): DrawdownYear[] {
  const retirementOnly = opts.retirementOnly ?? false;
  const out: DrawdownYear[] = [];
  let prevEnd: [PersonAccountBalances, PersonAccountBalances] = [zeroBal(), zeroBal()];

  for (let yi = 0; yi < result.rows.length; yi++) {
    const row = result.rows[yi];
    const open0 = yi === 0 ? zeroBal() : prevEnd[0];
    const open1 = yi === 0 ? zeroBal() : prevEnd[1];
    // First year: openings aren't on the row — if we need start balances matching inputs,
    // year 0 open stays 0 for "prior year end" semantics; year-end tracks stock thereafter.
    // For yi>0, open is exactly prior balancesEnd.
    const p0 = mapPerson(row.persons[0], 0, personNames[0], open0);
    const p1 = mapPerson(row.persons[1], 1, personNames[1], open1);
    prevEnd = [p0.balancesEnd, p1.balancesEnd];

    if (retirementOnly && !row.solverActive) continue;

    const householdWithdrawals = {
      unregistered: p0.withdrawals.unregistered + p1.withdrawals.unregistered,
      registered: p0.withdrawals.registered + p1.withdrawals.registered,
      lif: p0.withdrawals.lif + p1.withdrawals.lif,
      tfsa: p0.withdrawals.tfsa + p1.withdrawals.tfsa,
      topUp: p0.withdrawals.topUp + p1.withdrawals.topUp,
      total: p0.withdrawals.total + p1.withdrawals.total,
    };

    out.push({
      year: row.year,
      cpiIndex: row.cpiIndex,
      solverActive: row.solverActive,
      spendingTarget: row.spendingTarget,
      spendingAchieved: row.spendingAchieved,
      householdTax: row.householdTax,
      persons: [p0, p1],
      householdWithdrawals,
      householdBalancesEnd: sumBal(p0.balancesEnd, p1.balancesEnd),
    });
  }
  return out;
}

/** Retirement years only — primary drawdown UI series. */
export function retirementDrawdown(
  result: SimulationResult,
  personNames?: [string, string]
): DrawdownYear[] {
  return buildDrawdownLedger(result, personNames, { retirementOnly: true });
}

/** Flat rows for tables: one line per person per year. */
export interface DrawdownPersonFlatRow {
  year: number;
  personIndex: 0 | 1;
  name: string;
  age: number;
  unregistered: number;
  registered: number;
  lif: number;
  tfsa: number;
  topUp: number;
  totalWithdrawn: number;
  endRrsp: number;
  endLif: number;
  endTfsa: number;
  endUnreg: number;
  endTotal: number;
  openTotal: number;
}

export function flattenPersonDrawdown(years: DrawdownYear[]): DrawdownPersonFlatRow[] {
  const flat: DrawdownPersonFlatRow[] = [];
  for (const y of years) {
    for (const p of y.persons) {
      flat.push({
        year: y.year,
        personIndex: p.personIndex,
        name: p.name,
        age: p.ageDec31,
        unregistered: p.withdrawals.unregistered,
        registered: p.withdrawals.registered,
        lif: p.withdrawals.lif,
        tfsa: p.withdrawals.tfsa,
        topUp: p.withdrawals.topUp,
        totalWithdrawn: p.withdrawals.total,
        endRrsp: p.balancesEnd.rrsp,
        endLif: p.balancesEnd.lif,
        endTfsa: p.balancesEnd.tfsa,
        endUnreg: p.balancesEnd.unregistered,
        endTotal: p.balancesEnd.total,
        openTotal: p.balancesOpen.total,
      });
    }
  }
  return flat;
}

/** Balance series for charts: year-end stock by person and account. */
export interface BalanceTrackPoint {
  year: number;
  personIndex: 0 | 1;
  name: string;
  rrsp: number;
  lif: number;
  tfsa: number;
  unregistered: number;
  lira: number;
  dcPension: number;
  total: number;
}

export function balanceTrackSeries(years: DrawdownYear[]): BalanceTrackPoint[] {
  const pts: BalanceTrackPoint[] = [];
  for (const y of years) {
    for (const p of y.persons) {
      const b = p.balancesEnd;
      pts.push({
        year: y.year,
        personIndex: p.personIndex,
        name: p.name,
        rrsp: b.rrsp,
        lif: b.lif,
        tfsa: b.tfsa,
        unregistered: b.unregistered,
        lira: b.lira,
        dcPension: b.dcPension,
        total: b.total,
      });
    }
  }
  return pts;
}

/** Verify a drawdown year against the raw engine row (for tests / sanity). */
export function matchesEngineRow(
  d: DrawdownYear,
  row: YearRow,
  tol = 1e-6
): boolean {
  if (d.year !== row.year) return false;
  for (const i of [0, 1] as const) {
    const w = row.persons[i].withdrawals;
    const dw = d.persons[i].withdrawals;
    if (Math.abs(dw.registered - w.registered) > tol) return false;
    if (Math.abs(dw.lif - w.lif) > tol) return false;
    if (Math.abs(dw.tfsa - w.tfsa) > tol) return false;
    if (Math.abs(dw.unregistered - w.unregistered) > tol) return false;
    if (Math.abs(dw.topUp - w.topUp) > tol) return false;
    const be = row.persons[i].balancesEnd;
    const db = d.persons[i].balancesEnd;
    if (Math.abs(db.rrsp - be.rrsp) > tol) return false;
    if (Math.abs(db.lif - be.lif) > tol) return false;
    if (Math.abs(db.tfsa - be.tfsa) > tol) return false;
    if (Math.abs(db.unregistered - be.unregistered) > tol) return false;
  }
  return true;
}
