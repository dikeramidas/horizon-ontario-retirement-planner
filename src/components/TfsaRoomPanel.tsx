import type { SimulationResult } from "../simulate";
import { tfsaRoomSeries } from "../lib/tfsaRoomSeries";
import { money } from "../lib/format";
import { UnitBadge } from "./UnitBadge";
import { yearAxisLabels } from "../lib/chartAxis";
import { nearestIndex, moneyShort } from "../lib/chartHover";
import { useState } from "react";

const W = 640;
const H = 200;
const PAD = { t: 14, r: 12, b: 28, l: 48 };

function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** B7 — TFSA room + balances along the path. */
export function TfsaRoomPanel({
  result,
  personNames,
}: {
  result: SimulationResult;
  personNames: [string, string];
}) {
  const series = tfsaRoomSeries(result, false);
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) return null;

  const years = series.map((s) => s.year);
  const start = years[0];
  const room = series.map((s) => s.roomTotal);
  const bal = series.map((s) => s.balanceTotal);
  const ymax = Math.max(...room, ...bal, 1);
  const x = scaleLinear([0, series.length - 1], [PAD.l, W - PAD.r]);
  const y = scaleLinear([0, ymax], [H - PAD.b, PAD.t]);
  const line = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const labels = yearAxisLabels(start, series.length);
  const hi = hover ?? series.length - 1;
  const tip = series[hi];

  return (
    <div className="chart-wrap" data-testid="tfsa-room-panel">
      <h3>
        TFSA room &amp; balances <UnitBadge unit="nominal" />
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        End-of-year contribution room (both spouses) and TFSA balances. Meltdown surplus can use room;
        L3/L4 reserve tries to protect a spending buffer. Hover for a year readout.
      </p>
      <div className="chart-legend">
        <span>
          <i className="swatch" style={{ background: "var(--cyan)" }} /> Room total
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--lime)" }} /> Balance total
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--magenta)" }} /> {personNames[0]} bal
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--violet)" }} /> {personNames[1]} bal
        </span>
      </div>
      {tip && (
        <div className="chart-hover-tip" data-testid="tfsa-hover-tip">
          <strong>{tip.year}</strong>
          {" · room "}
          {moneyShort(tip.roomTotal)}
          {" · bal "}
          {moneyShort(tip.balanceTotal)}
          {" · out "}
          {moneyShort(tip.withdrawn)}
          {" · in "}
          {moneyShort(tip.contributed)}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="TFSA room and balances"
        onMouseMove={(e) => {
          const svg = e.currentTarget;
          setHover(nearestIndex(e.clientX, svg, series.length, PAD.l, PAD.r));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={line(room)} fill="none" stroke="#3de7ff" strokeWidth="2" />
        <path d={line(bal)} fill="none" stroke="#c8f542" strokeWidth="2.2" />
        <path
          d={line(series.map((s) => s.balanceA))}
          fill="none"
          stroke="#ff4d9a"
          strokeWidth="1.4"
          strokeDasharray="4 3"
        />
        <path
          d={line(series.map((s) => s.balanceB))}
          fill="none"
          stroke="#9b7bff"
          strokeWidth="1.4"
          strokeDasharray="4 3"
        />
        {hover != null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="rgba(255,255,255,0.25)"
            strokeDasharray="3 3"
          />
        )}
        {labels.map((year) => {
          const i = year - start;
          if (i < 0 || i >= series.length) return null;
          return (
            <text
              key={year}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}
              fill="rgba(238,240,255,0.45)"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {year}
            </text>
          );
        })}
      </svg>
      <div className="table-scroll cashflow-table-scroll" style={{ marginTop: "0.65rem" }}>
        <table className="cash cash-dense">
          <thead>
            <tr>
              <th>Year</th>
              <th>Room</th>
              <th>Balance</th>
              <th>Withdrawn</th>
              <th>Contributed</th>
            </tr>
          </thead>
          <tbody>
            {series
              .filter((_, i) => i % 5 === 0 || i === series.length - 1)
              .map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td>
                  <td>{money(r.roomTotal, { dense: true })}</td>
                  <td>{money(r.balanceTotal, { dense: true })}</td>
                  <td>{money(r.withdrawn, { dense: true })}</td>
                  <td>{money(r.contributed, { dense: true })}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
