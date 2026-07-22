import { useMemo, useRef, useState } from "react";
import type { HouseholdInput } from "../simulate";
import type { SavedScenario } from "../lib/scenarioStore";
import {
  type ScenarioCompareResult,
  type ScenarioSideInput,
} from "../lib/scenarioCompare";
import { compareScenariosAsync, EngineJobCancelled } from "../lib/engineClient";
import { money } from "../lib/format";
import { UnitBadge } from "./UnitBadge";
import type { ProgressEvent } from "../lib/progress";

const W = 640;
const H = 200;
const PAD = { t: 14, r: 12, b: 28, l: 48 };

function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function DualNetWorthChart({
  left,
  right,
}: {
  left: ScenarioCompareResult["left"];
  right: ScenarioCompareResult["right"];
}) {
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const p of left.netWorthRealByYear) set.add(p.year);
    for (const p of right.netWorthRealByYear) set.add(p.year);
    return [...set].sort((a, b) => a - b);
  }, [left, right]);

  if (years.length < 2) return null;

  const mapL = new Map(left.netWorthRealByYear.map((p) => [p.year, p.value]));
  const mapR = new Map(right.netWorthRealByYear.map((p) => [p.year, p.value]));
  const valsL = years.map((y) => mapL.get(y) ?? 0);
  const valsR = years.map((y) => mapR.get(y) ?? 0);
  const ymin = Math.min(0, ...valsL, ...valsR);
  const ymax = Math.max(...valsL, ...valsR, 1);
  const x = scaleLinear([0, years.length - 1], [PAD.l, W - PAD.r]);
  const y = scaleLinear([ymin, ymax], [H - PAD.b, PAD.t]);
  const line = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ymin + (ymax - ymin) * t);
  const fmt = (t: number) =>
    t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(0)}k` : t.toFixed(0);

  return (
    <div className="chart-wrap" data-testid="scenario-compare-chart">
      <h4 style={{ margin: "0.75rem 0 0.35rem", fontWeight: 500 }}>
        Real household net worth <UnitBadge unit="real" />
      </h4>
      <div className="chart-legend">
        <span>
          <i className="swatch" style={{ background: "var(--lime)" }} /> {left.label}
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--magenta)" }} /> {right.label}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Scenario net worth compare">
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
              {fmt(t)}
            </text>
          </g>
        ))}
        <path d={line(valsL)} fill="none" stroke="#c8f542" strokeWidth="2.2" />
        <path d={line(valsR)} fill="none" stroke="#ff4d9a" strokeWidth="2.2" />
        <text x={PAD.l} y={H - 8} fill="rgba(238,240,255,0.4)" fontSize="9">
          {years[0]}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" fill="rgba(238,240,255,0.4)" fontSize="9">
          {years[years.length - 1]}
        </text>
      </svg>
    </div>
  );
}

function deltaClass(n: number, invert = false): string {
  if (Math.abs(n) < 1) return "";
  const good = invert ? n < 0 : n > 0;
  return good ? "delta-pos" : "delta-neg";
}

export function ScenarioComparePanel({
  scenarios,
  currentInput,
  currentLabel = "Current form",
}: {
  scenarios: SavedScenario[];
  currentInput: HouseholdInput;
  currentLabel?: string;
}) {
  const options = useMemo(() => {
    const opts: Array<{ id: string; label: string; inputs: HouseholdInput }> = [
      { id: "__current__", label: currentLabel, inputs: currentInput },
      ...scenarios.map((s) => ({ id: s.id, label: s.name, inputs: s.inputs })),
    ];
    return opts;
  }, [scenarios, currentInput, currentLabel]);

  const [leftId, setLeftId] = useState("__current__");
  const [rightId, setRightId] = useState(scenarios[0]?.id ?? "__current__");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioCompareResult | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resolve = (id: string): ScenarioSideInput | null => {
    const o = options.find((x) => x.id === id);
    if (!o) return null;
    return { id: o.id, label: o.label, inputs: o.inputs };
  };

  const run = async () => {
    const L = resolve(leftId);
    const R = resolve(rightId);
    if (!L || !R) {
      setErr("Pick two scenarios to compare.");
      return;
    }
    if (L.id === R.id && L.id !== "__current__") {
      setErr("Pick two different scenarios (or current form vs a saved plan).");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setErr(null);
    setProgress({ phase: "start", fraction: 0, detail: "Starting compare…" });
    try {
      setResult(
        await compareScenariosAsync(L, R, { quick: true }, {
          signal: ac.signal,
          onProgress: setProgress,
        })
      );
    } catch (e) {
      if (e instanceof EngineJobCancelled) {
        setErr(null);
      } else {
        setErr(e instanceof Error ? e.message : String(e));
        setResult(null);
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="scenario-compare" data-testid="scenario-compare">
      <h3 style={{ margin: "1rem 0 0.35rem", fontFamily: "var(--font-display)", fontWeight: 400 }}>
        Compare two plans
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Side-by-side expected-path analysis (tax-aware ceiling re-tuned per plan). Deltas are right −
        left. Not a market stress test.
      </p>
      <div className="field-grid">
        <FieldSelect
          label="Left (A)"
          value={leftId}
          onChange={setLeftId}
          options={options}
          testId="compare-left"
        />
        <FieldSelect
          label="Right (B)"
          value={rightId}
          onChange={setRightId}
          options={options}
          testId="compare-right"
        />
      </div>
      <div style={{ marginTop: "0.65rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="run-scenario-compare"
          disabled={busy || options.length < 1}
          onClick={() => void run()}
        >
          {busy ? "Comparing…" : "Compare"}
        </button>
        {busy && (
          <button
            type="button"
            className="btn btn-danger"
            data-testid="cancel-scenario-compare"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </button>
        )}
      </div>
      {busy && progress && (
        <p className="hint" data-testid="compare-progress">
          {progress.detail}
          {progress.fraction != null ? ` · ${Math.round(progress.fraction * 100)}%` : ""}
        </p>
      )}
      {err && <p className="error-banner">{err}</p>}
      {result && (
        <>
          <div className="table-scroll" style={{ marginTop: "0.75rem", maxHeight: "none" }}>
            <table className="cash compare-table" data-testid="scenario-compare-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>{result.left.label}</th>
                  <th>{result.right.label}</th>
                  <th>Δ (B − A)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Spending (today&apos;s $)</td>
                  <td>{money(result.left.spendingTargetToday)}</td>
                  <td>{money(result.right.spendingTargetToday)}</td>
                  <td className={deltaClass(result.deltas.spending, true)}>
                    {money(result.deltas.spending)}
                  </td>
                </tr>
                <tr>
                  <td>Retirement ages</td>
                  <td>
                    {result.left.retirementAges[0]} / {result.left.retirementAges[1]}
                  </td>
                  <td>
                    {result.right.retirementAges[0]} / {result.right.retirementAges[1]}
                  </td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>Horizon (younger age)</td>
                  <td>{result.left.horizonAgeYoungerSpouse}</td>
                  <td>{result.right.horizonAgeYoungerSpouse}</td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>Top-up ceiling C</td>
                  <td>{money(result.left.bestCeilingToday)}</td>
                  <td>{money(result.right.bestCeilingToday)}</td>
                  <td className={deltaClass(result.deltas.ceiling)}>
                    {money(result.deltas.ceiling)}
                  </td>
                </tr>
                <tr>
                  <td>TFSA policy</td>
                  <td>
                    {result.left.tfsaLevel}
                    {result.left.tfsaLevel === "l3" || result.left.tfsaLevel === "l4"
                      ? ` · reserve ${result.left.tfsaReserveYears}y`
                      : ""}
                  </td>
                  <td>
                    {result.right.tfsaLevel}
                    {result.right.tfsaLevel === "l3" || result.right.tfsaLevel === "l4"
                      ? ` · reserve ${result.right.tfsaReserveYears}y`
                      : ""}
                  </td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>Funded (expected path)</td>
                  <td data-testid="compare-left-funded">
                    {result.left.funded
                      ? "Yes"
                      : `Short${result.left.firstFailureYear != null ? ` (${result.left.firstFailureYear})` : ""}`}
                  </td>
                  <td data-testid="compare-right-funded">
                    {result.right.funded
                      ? "Yes"
                      : `Short${result.right.firstFailureYear != null ? ` (${result.right.firstFailureYear})` : ""}`}
                  </td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>
                    Lifetime tax <UnitBadge unit="nominal" />
                  </td>
                  <td>{money(result.left.lifetimeTax)}</td>
                  <td>{money(result.right.lifetimeTax)}</td>
                  <td className={deltaClass(result.deltas.lifetimeTax, true)}>
                    {money(result.deltas.lifetimeTax)}
                  </td>
                </tr>
                <tr>
                  <td>
                    Estate tax <UnitBadge unit="nominal" />
                  </td>
                  <td>{money(result.left.estateTax)}</td>
                  <td>{money(result.right.estateTax)}</td>
                  <td className={deltaClass(result.deltas.estateTax, true)}>
                    {money(result.deltas.estateTax)}
                  </td>
                </tr>
                <tr>
                  <td>
                    After-tax estate <UnitBadge unit="real" />
                  </td>
                  <td data-testid="compare-left-estate">{money(result.left.estateReal)}</td>
                  <td data-testid="compare-right-estate">{money(result.right.estateReal)}</td>
                  <td
                    className={deltaClass(result.deltas.estateReal)}
                    data-testid="compare-delta-estate"
                  >
                    {money(result.deltas.estateReal)}
                  </td>
                </tr>
                <tr>
                  <td>Tax saved vs naive (own path)</td>
                  <td>{money(result.left.totalTaxSaving)}</td>
                  <td>{money(result.right.totalTaxSaving)}</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <DualNetWorthChart left={result.left} right={result.right} />
        </>
      )}
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: Array<{ id: string; label: string }>;
  testId: string;
}) {
  return (
    <label className="field field-stack">
      <span className="field-label-row">
        <span className="field-label-text">{label}</span>
      </span>
      <span className="field-control">
        <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
