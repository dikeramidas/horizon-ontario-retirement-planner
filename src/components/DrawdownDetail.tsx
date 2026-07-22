import { useMemo } from "react";
import type { SimulationResult } from "../simulate";
import { retirementDrawdown, balanceTrackSeries, type DrawdownYear } from "../lib/drawdown";
import { yearAxisLabels } from "../lib/chartAxis";
import { WithdrawalsYearTable, BalancesYearTable } from "./DrawdownTables";
import { UnitBadge } from "./UnitBadge";
import { GlossaryTip } from "./GlossaryTip";

const W = 640;
const H = 200;
const PAD = { t: 14, r: 12, b: 28, l: 48 };

function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function BalanceLines({
  years,
  names,
}: {
  years: DrawdownYear[];
  names: [string, string];
}) {
  const series = balanceTrackSeries(years);
  if (!series.length) return null;
  const ys = [...new Set(series.map((p) => p.year))].sort((a, b) => a - b);
  const aTot = ys.map((y) => series.find((p) => p.year === y && p.personIndex === 0)!.total);
  const bTot = ys.map((y) => series.find((p) => p.year === y && p.personIndex === 1)!.total);
  const hh = ys.map((_, i) => aTot[i] + bTot[i]);
  const ymin = 0;
  const ymax = Math.max(...hh, 1);
  const x = scaleLinear([0, Math.max(1, ys.length - 1)], [PAD.l, W - PAD.r]);
  const y = scaleLinear([ymin, ymax], [H - PAD.b, PAD.t]);
  const line = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const startYear = ys[0];
  const endYear = ys[ys.length - 1];
  const yearToIndex = new Map(ys.map((year, i) => [year, i]));
  const calendarSpan = endYear - startYear + 1;
  const labelYears = [
    ...new Set([
      startYear,
      ...yearAxisLabels(startYear, calendarSpan).filter((year) => yearToIndex.has(year)),
      endYear,
    ]),
  ].sort((a, b) => a - b);

  const yTickCount = 4;
  const yTicks = Array.from(
    { length: yTickCount + 1 },
    (_, i) => ymin + ((ymax - ymin) * i) / yTickCount
  );
  const formatY = (t: number) =>
    t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(0)}k` : t.toFixed(0);

  return (
    <div className="chart-wrap" data-testid="balance-chart">
      <h3>
        Account balances over time <UnitBadge unit="nominal" />
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Year-end total wealth by person (<strong>nominal year-$</strong>). Household = dashed.
      </p>
      <div className="chart-legend">
        <span>
          <i className="swatch" style={{ background: "var(--lime)" }} /> {names[0]}
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--magenta)" }} /> {names[1]}
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--cyan)" }} /> Household
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Balances by person">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(255,255,255,0.06)"
            />
            <text
              x={PAD.l - 6}
              y={y(t) + 3}
              textAnchor="end"
              fill="rgba(238,240,255,0.45)"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatY(t)}
            </text>
          </g>
        ))}
        <path d={line(aTot)} fill="none" stroke="#c8f542" strokeWidth="2.2" />
        <path d={line(bTot)} fill="none" stroke="#ff4d9a" strokeWidth="2.2" />
        <path d={line(hh)} fill="none" stroke="#3de7ff" strokeWidth="1.6" strokeDasharray="5 4" />
        {labelYears.map((year) => {
          const i = yearToIndex.get(year);
          if (i == null) return null;
          const px = x(i);
          const isFirst = year === startYear;
          const isLast = year === endYear;
          return (
            <g key={year}>
              <line
                x1={px}
                x2={px}
                y1={H - PAD.b}
                y2={H - PAD.b + 4}
                stroke="rgba(238,240,255,0.25)"
              />
              <text
                x={px}
                y={H - 8}
                textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                fill="rgba(238,240,255,0.45)"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {year}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Compact embed on the results dashboard — with links to full-page tables. */
export function DrawdownDetail({
  result,
  personNames,
}: {
  result: SimulationResult;
  personNames: [string, string];
}) {
  const years = useMemo(
    () => retirementDrawdown(result, personNames),
    [result, personNames]
  );

  if (!years.length) return null;

  return (
    <div className="drawdown-detail" data-testid="drawdown-detail">
      <div className="chart-wrap" style={{ marginBottom: "0.75rem" }}>
        <h3>Drawdown detail</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          One row per year; columns grouped by person. Open a full page for the complete table without
          a nested scroll box.
        </p>
        <div className="drawdown-links" data-testid="drawdown-full-links">
          <a
            href="#/drawdown/withdrawals"
            className="btn btn-primary"
            data-testid="link-full-withdrawals"
          >
            Full withdrawals table
          </a>
          <a
            href="#/drawdown/balances"
            className="btn"
            data-testid="link-full-balances"
          >
            Full balances table
          </a>
        </div>
      </div>

      <div className="chart-wrap">
        <div className="panel-head" style={{ padding: "0 0 0.5rem" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.25rem" }}>
            Withdrawals preview
          </h3>
          <a href="#/drawdown/withdrawals" className="link-btn" data-testid="link-withdrawals-inline">
            Open full page →
          </a>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          Nested scroll for a quick look — use the full page for every year at once.
        </p>
        <WithdrawalsYearTable years={years} personNames={personNames} fullPage={false} />
      </div>

      <BalanceLines years={years} names={personNames} />

      <div className="chart-wrap">
        <div className="panel-head" style={{ padding: "0 0 0.5rem" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.25rem" }}>
            Balances preview
          </h3>
          <a href="#/drawdown/balances" className="link-btn" data-testid="link-balances-inline">
            Open full page →
          </a>
        </div>
        <BalancesYearTable years={years} personNames={personNames} fullPage={false} />
      </div>
    </div>
  );
}
