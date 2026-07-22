import { useState } from "react";
import type { MonteCarloResult } from "../mc";
import type { SimulationResult } from "../simulate";
import { cashflowSeries, householdNetWorth, personNetWorth } from "../lib/cashflow";
import { yearAxisLabels } from "../lib/chartAxis";
import { nearestIndex, moneyShort } from "../lib/chartHover";
import { UnitBadge } from "./UnitBadge";

const W = 640;
const H = 240;
const PAD = { t: 16, r: 12, b: 28, l: 48 };

/**
 * Household vs people must not share a hue family:
 *   household expected = lime, MC = cyan band/median
 *   person A = violet, person B = magenta (same accents as drawdown tables)
 */
const NW_COLORS = {
  householdDet: "#c8f542",
  householdMcMedian: "#3de7ff",
  householdBand: "rgba(61,231,255,0.16)",
  personA: "#9b7bff",
  personB: "#ff4d9a",
} as const;

function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function realPersonSeries(det: SimulationResult, personIndex: 0 | 1): number[] {
  return det.rows.map((r) => personNetWorth(r, personIndex) / r.cpiIndex);
}

export function FanChart({
  mc,
  det,
  personNames = ["Spouse A", "Spouse B"],
}: {
  mc?: MonteCarloResult | null;
  det?: SimulationResult | null;
  personNames?: [string, string];
}) {
  const years = mc?.years ?? det?.rows.length ?? 0;
  if (!years) return <p className="hint">Run a simulation to paint the horizon.</p>;

  const start = mc?.startYear ?? det!.rows[0].year;
  const xs = Array.from({ length: years }, (_, i) => start + i);

  const series: {
    p10?: number[];
    p50?: number[];
    p90?: number[];
    detHousehold?: number[];
    detPerson0?: number[];
    detPerson1?: number[];
  } = {};

  if (mc) {
    series.p10 = mc.netWorthRealPercentiles.p10;
    series.p50 = mc.netWorthRealPercentiles.p50;
    series.p90 = mc.netWorthRealPercentiles.p90;
  }
  if (det) {
    series.detHousehold = det.rows.map((r) => householdNetWorth(r) / r.cpiIndex);
    series.detPerson0 = realPersonSeries(det, 0);
    series.detPerson1 = realPersonSeries(det, 1);
  }

  const all = [
    ...(series.p10 ?? []),
    ...(series.p50 ?? []),
    ...(series.p90 ?? []),
    ...(series.detHousehold ?? []),
    ...(series.detPerson0 ?? []),
    ...(series.detPerson1 ?? []),
  ];
  const ymin = Math.min(0, ...all);
  const ymax = Math.max(...all, 1);

  const x = scaleLinear([0, years - 1], [PAD.l, W - PAD.r]);
  const y = scaleLinear([ymin, ymax], [H - PAD.b, PAD.t]);

  const line = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const band =
    series.p10 && series.p90
      ? [
          ...series.p90.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`),
          ...[...series.p10].reverse().map((v, i) => {
            const idx = series.p10!.length - 1 - i;
            return `L${x(idx).toFixed(1)},${y(v).toFixed(1)}`;
          }),
          "Z",
        ].join(" ")
      : null;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => ymin + ((ymax - ymin) * i) / ticks);
  const xYearLabels = yearAxisLabels(start, years);
  const [hover, setHover] = useState<number | null>(null);
  const hi = hover ?? years - 1;
  const hoverYear = start + hi;

  return (
    <div className="chart-wrap" data-testid="fan-chart">
      <h3>
        Real net worth trajectory <UnitBadge unit="real" />
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Household total and each spouse&apos;s investable accounts (RRSP/LIF/TFSA/unreg), in{" "}
        <strong>today&apos;s $</strong> (÷ CPI). Person lines use the expected-return path; the fan is
        household Monte Carlo when run. Hover a year for a readout.
      </p>
      <div className="chart-hover-tip" data-testid="fan-hover-tip">
        <strong>{hoverYear}</strong>
        {series.detHousehold && <> · hh {moneyShort(series.detHousehold[hi] ?? 0)}</>}
        {series.detPerson0 && <> · A {moneyShort(series.detPerson0[hi] ?? 0)}</>}
        {series.detPerson1 && <> · B {moneyShort(series.detPerson1[hi] ?? 0)}</>}
        {series.p50 && <> · MC med {moneyShort(series.p50[hi] ?? 0)}</>}
      </div>
      <div className="chart-legend">
        {mc && (
          <>
            <span>
              <i className="swatch" style={{ background: "rgba(61,231,255,0.35)" }} /> household p10–p90
            </span>
            <span>
              <i className="swatch" style={{ background: NW_COLORS.householdMcMedian }} /> household median
            </span>
          </>
        )}
        {det && (
          <>
            <span>
              <i className="swatch" style={{ background: NW_COLORS.householdDet }} /> household
              {mc ? " (expected)" : ""}
            </span>
            <span>
              <i className="swatch" style={{ background: NW_COLORS.personA }} /> {personNames[0]}
            </span>
            <span>
              <i className="swatch" style={{ background: NW_COLORS.personB }} /> {personNames[1]}
            </span>
          </>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Real net worth trajectory for household and each person"
        onMouseMove={(e) => setHover(nearestIndex(e.clientX, e.currentTarget, years, PAD.l, PAD.r))}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
            <text
              x={PAD.l - 6}
              y={y(t) + 3}
              textAnchor="end"
              fill="rgba(238,240,255,0.45)"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(0)}k` : t.toFixed(0)}
            </text>
          </g>
        ))}
        {band && <path d={band} fill={NW_COLORS.householdBand} stroke="none" />}
        {series.p50 && (
          <path
            d={line(series.p50)}
            fill="none"
            stroke={NW_COLORS.householdMcMedian}
            strokeWidth="2.2"
          />
        )}
        {series.detPerson0 && (
          <path
            d={line(series.detPerson0)}
            fill="none"
            stroke={NW_COLORS.personA}
            strokeWidth="1.85"
            data-testid="nw-person-a"
          />
        )}
        {series.detPerson1 && (
          <path
            d={line(series.detPerson1)}
            fill="none"
            stroke={NW_COLORS.personB}
            strokeWidth="1.85"
            data-testid="nw-person-b"
          />
        )}
        {series.detHousehold && (
          <path
            d={line(series.detHousehold)}
            fill="none"
            stroke={NW_COLORS.householdDet}
            strokeWidth="2.4"
            strokeDasharray={mc ? "5 4" : undefined}
            data-testid="nw-household"
          />
        )}
        {hover != null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="rgba(255,255,255,0.28)"
            strokeDasharray="3 3"
          />
        )}
        {xYearLabels.map((year) => {
          const i = year - start;
          const px = x(i);
          const isFirst = year === xs[0];
          const isLast = year === xs[xs.length - 1];
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

const COLORS = {
  unregistered: "#ffb84d",
  registered: "#9b7bff",
  lif: "#ff4d9a",
  tfsa: "#3de7ff",
  topUp: "#c8f542",
};

export function WithdrawalStackChart({ result }: { result: SimulationResult }) {
  const rows = cashflowSeries(result, true).filter(
    (r) => r.unregistered + r.registered + r.lif + r.tfsa + r.topUp > 1
  );
  if (!rows.length) return null;

  const keys = ["unregistered", "registered", "lif", "tfsa", "topUp"] as const;
  const totals = rows.map((r) => keys.reduce((s, k) => s + r[k], 0));
  const ymax = Math.max(...totals, 1);
  const barW = Math.max(4, Math.min(18, (W - PAD.l - PAD.r) / rows.length - 2));
  const x = scaleLinear([0, Math.max(1, rows.length - 1)], [PAD.l, W - PAD.r - barW]);
  const y = scaleLinear([0, ymax], [H - PAD.b, PAD.t]);

  const startYear = rows[0].year;
  const endYear = rows[rows.length - 1].year;
  const calendarSpan = endYear - startYear + 1;
  const yearToIndex = new Map(rows.map((r, i) => [r.year, i]));
  // Prefer labels that land on years we actually have a bar for
  const xYearLabels = yearAxisLabels(startYear, calendarSpan).filter(
    (year, idx, arr) =>
      yearToIndex.has(year) || year === arr[0] || year === arr[arr.length - 1]
  );
  // Map start/end to first/last row even if step-aligned years skipped them
  const labelYears = [...new Set([
    startYear,
    ...xYearLabels.filter((y) => yearToIndex.has(y)),
    endYear,
  ])].sort((a, b) => a - b);

  return (
    <div className="chart-wrap" data-testid="withdrawal-chart">
      <h3>
        Where the money comes from <UnitBadge unit="nominal" />
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Discretionary + forced withdrawals by account (retirement years,{" "}
        <strong>nominal year-$</strong>).
      </p>
      <div className="chart-legend">
        {keys.map((k) => (
          <span key={k}><i className="swatch" style={{ background: COLORS[k] }} /> {k}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Withdrawals by account">
        {rows.map((r, i) => {
          let acc = 0;
          return (
            <g key={r.year}>
              {keys.map((k) => {
                const v = r[k];
                if (v <= 0) return null;
                const y0 = y(acc + v);
                const y1 = y(acc);
                acc += v;
                return (
                  <rect
                    key={k}
                    x={x(i)}
                    y={y0}
                    width={barW}
                    height={Math.max(0.5, y1 - y0)}
                    fill={COLORS[k]}
                    opacity={0.9}
                  />
                );
              })}
            </g>
          );
        })}
        {labelYears.map((year) => {
          const i = yearToIndex.get(year);
          if (i == null) return null;
          const isFirst = year === startYear;
          const isLast = year === endYear;
          const barMid = x(i) + barW / 2;
          const px = isFirst ? x(i) : isLast ? x(i) + barW : barMid;
          return (
            <g key={year}>
              <line
                x1={barMid}
                x2={barMid}
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
