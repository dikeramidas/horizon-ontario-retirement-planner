import type { DrawdownYear, PersonDrawdownYear } from "../lib/drawdown";
import { money } from "../lib/format";
import { GlossaryTip } from "./GlossaryTip";

const W_COLS = ["Age", "Unreg", "RRSP/RRIF", "LIF", "TFSA", "Top-up", "Total out"] as const;
const B_COLS = ["Open", "RRSP", "LIRA", "DC", "LIF", "TFSA", "Unreg", "End total"] as const;

function personWithdrawCells(p: PersonDrawdownYear) {
  return (
    <>
      <td>{p.ageDec31}</td>
      <td>{money(p.withdrawals.unregistered)}</td>
      <td>{money(p.withdrawals.registered)}</td>
      <td>{money(p.withdrawals.lif)}</td>
      <td>{money(p.withdrawals.tfsa)}</td>
      <td>{money(p.withdrawals.topUp)}</td>
      <td>{money(p.withdrawals.total)}</td>
    </>
  );
}

function personBalanceCells(p: PersonDrawdownYear) {
  return (
    <>
      <td>{money(p.balancesOpen.total)}</td>
      <td>{money(p.balancesEnd.rrsp)}</td>
      <td>{money(p.balancesEnd.lira)}</td>
      <td>{money(p.balancesEnd.dcPension)}</td>
      <td>{money(p.balancesEnd.lif)}</td>
      <td>{money(p.balancesEnd.tfsa)}</td>
      <td>{money(p.balancesEnd.unregistered)}</td>
      <td>{money(p.balancesEnd.total)}</td>
    </>
  );
}

export function WithdrawalsYearTable({
  years,
  personNames,
  fullPage = false,
}: {
  years: DrawdownYear[];
  personNames: [string, string];
  fullPage?: boolean;
}) {
  const nA = personNames[0];
  const nB = personNames[1];
  return (
    <div
      className={fullPage ? "table-scroll-full" : "table-scroll table-scroll-tall"}
      data-testid="drawdown-person-table"
    >
      <table className="cash cash-grouped">
        <thead>
          <tr className="group-row">
            <th rowSpan={2} className="sticky-corner">
              Year
            </th>
            <th rowSpan={2}>Spend</th>
            <th colSpan={W_COLS.length} className="group-a" data-person={nA}>
              {nA}
            </th>
            <th colSpan={W_COLS.length} className="group-b" data-person={nB}>
              {nB}
            </th>
            <th rowSpan={2}>
              <GlossaryTip term="hhTax">HH tax</GlossaryTip>
            </th>
          </tr>
          <tr className="subhead-row">
            {W_COLS.map((c) => (
              <th key={`a-${c}`} className="group-a">
                {c}
              </th>
            ))}
            {W_COLS.map((c) => (
              <th key={`b-${c}`} className="group-b">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year} data-year={y.year}>
              <td>{y.year}</td>
              <td>{money(y.spendingAchieved)}</td>
              {personWithdrawCells(y.persons[0])}
              {personWithdrawCells(y.persons[1])}
              <td>{money(y.householdTax)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BalancesYearTable({
  years,
  personNames,
  fullPage = false,
}: {
  years: DrawdownYear[];
  personNames: [string, string];
  fullPage?: boolean;
}) {
  const nA = personNames[0];
  const nB = personNames[1];
  return (
    <div
      className={fullPage ? "table-scroll-full" : "table-scroll table-scroll-tall"}
      data-testid="balance-ledger-table"
    >
      <table className="cash cash-grouped">
        <thead>
          <tr className="group-row">
            <th rowSpan={2} className="sticky-corner">
              Year
            </th>
            <th colSpan={B_COLS.length} className="group-a" data-person={nA}>
              {nA}
            </th>
            <th colSpan={B_COLS.length} className="group-b" data-person={nB}>
              {nB}
            </th>
            <th rowSpan={2}>HH end</th>
          </tr>
          <tr className="subhead-row">
            {B_COLS.map((c) => (
              <th key={`a-${c}`} className="group-a">
                {c}
              </th>
            ))}
            {B_COLS.map((c) => (
              <th key={`b-${c}`} className="group-b">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year} data-year={y.year}>
              <td>{y.year}</td>
              {personBalanceCells(y.persons[0])}
              {personBalanceCells(y.persons[1])}
              <td>{money(y.householdBalancesEnd.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
