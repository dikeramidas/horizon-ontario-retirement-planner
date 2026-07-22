import type { SimulationResult } from "../simulate";
import { cashflowSeries } from "../lib/cashflow";
import { money } from "../lib/format";
import { UnitBadge } from "./UnitBadge";

const m = (n: number) => money(n, { dense: true });

export function CashflowTable({ result }: { result: SimulationResult }) {
  const rows = cashflowSeries(result, true);
  if (!rows.length) return null;

  // Hide income columns that are always ~0 for this plan (e.g. no DB pension).
  const show = {
    salary: rows.some((r) => r.salary > 1),
    cpp: rows.some((r) => r.cpp > 1),
    oas: rows.some((r) => r.oas > 1),
    db: rows.some((r) => r.db > 1),
    unregistered: rows.some((r) => r.unregistered > 1),
    registered: rows.some((r) => r.registered > 1),
    lif: rows.some((r) => r.lif > 1),
    tfsa: rows.some((r) => r.tfsa > 1),
    topUp: rows.some((r) => r.topUp > 1),
  };

  return (
    <div className="chart-wrap" data-testid="cashflow-table">
      <h3>
        Year-by-year: where the money comes from <UnitBadge unit="nominal" />
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Retirement years — paycheques & benefits, then which accounts fund the lifestyle, and tax paid.
        Figures are <strong>nominal year-$</strong> (not today&apos;s $). Compact formatting; empty
        sources hidden.
      </p>
      <div className="table-scroll cashflow-table-scroll">
        <table className="cash cash-dense">
          <thead>
            <tr>
              <th>Year</th>
              {show.salary && <th>Salary</th>}
              {show.cpp && <th>CPP</th>}
              {show.oas && <th>OAS</th>}
              {show.db && <th>DB</th>}
              {show.unregistered && <th>Unreg</th>}
              {show.registered && <th>RRSP</th>}
              {show.lif && <th>LIF</th>}
              {show.tfsa && <th>TFSA</th>}
              {show.topUp && <th>Top-up</th>}
              <th>Tax</th>
              <th>Spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}>
                <td>{r.year}</td>
                {show.salary && <td>{m(r.salary)}</td>}
                {show.cpp && <td>{m(r.cpp)}</td>}
                {show.oas && <td>{m(r.oas)}</td>}
                {show.db && <td>{m(r.db)}</td>}
                {show.unregistered && <td>{m(r.unregistered)}</td>}
                {show.registered && <td>{m(r.registered)}</td>}
                {show.lif && <td>{m(r.lif)}</td>}
                {show.tfsa && <td>{m(r.tfsa)}</td>}
                {show.topUp && <td>{m(r.topUp)}</td>}
                <td>{m(r.tax)}</td>
                <td>{m(r.spending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
