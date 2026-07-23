import { useMemo, useState } from "react";
import type { HouseholdInput } from "../simulate";
import {
  DEFAULT_LONGEVITY_AGES,
  runLongevityScenarios,
  survivorshipFromRow,
  type LongevityScenarioResult,
  type LongevityScenarioRow,
} from "../lib/longevityScenarios";
import {
  runStochasticLongevity,
  type StochasticLongevityResult,
} from "../lib/stochasticLongevity";
import { money, pct } from "../lib/format";
import { GlossaryTip } from "./GlossaryTip";
import { UnitBadge } from "./UnitBadge";

const AGE_PRESETS = [...DEFAULT_LONGEVITY_AGES] as number[];

export function LongevityPanel({
  input,
  personNames,
  onApplySurvivorship,
}: {
  input: HouseholdInput;
  personNames: [string, string];
  onApplySurvivorship: (survivorship: NonNullable<HouseholdInput["survivorship"]>) => void;
}) {
  const [ages, setAges] = useState<number[]>(AGE_PRESETS);
  const [frac, setFrac] = useState(input.survivorship?.survivorSpendFrac ?? 0.7);
  const [busy, setBusy] = useState(false);
  const [busyMc, setBusyMc] = useState(false);
  const [result, setResult] = useState<LongevityScenarioResult | null>(null);
  const [stoch, setStoch] = useState<StochasticLongevityResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [mcTrials, setMcTrials] = useState(300);
  const [mcSeed, setMcSeed] = useState(1);

  const toggleAge = (age: number) => {
    setAges((prev) => {
      if (prev.includes(age)) {
        const next = prev.filter((a) => a !== age);
        return next.length ? next : prev;
      }
      return [...prev, age].sort((a, b) => a - b);
    });
  };

  const run = () => {
    setBusy(true);
    setErr(null);
    setProgress("Running…");
    window.setTimeout(() => {
      try {
        const res = runLongevityScenarios(input, {
          deathAges: ages,
          survivorSpendFrac: frac,
          onProgress: (p) => setProgress(p.detail ?? null),
        });
        setResult(res);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setResult(null);
      } finally {
        setBusy(false);
        setProgress(null);
      }
    }, 20);
  };

  const runStoch = () => {
    setBusyMc(true);
    setErr(null);
    setProgress("Sampling mortality…");
    window.setTimeout(() => {
      try {
        const res = runStochasticLongevity(input, {
          trials: mcTrials,
          seed: mcSeed,
          survivorSpendFrac: frac,
          onProgress: (p) => setProgress(p.detail ?? null),
        });
        setStoch(res);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStoch(null);
      } finally {
        setBusyMc(false);
        setProgress(null);
      }
    }, 20);
  };

  const baselineEstate = useMemo(
    () => result?.rows.find((r) => r.kind === "baseline")?.estateReal,
    [result]
  );

  const apply = (row: LongevityScenarioRow) => {
    const s = survivorshipFromRow(row, frac);
    if (!s) return;
    if (row.kind === "baseline") {
      onApplySurvivorship({
        enabled: false,
        firstDeathPerson: input.survivorship?.firstDeathPerson ?? 0,
        firstDeathYear:
          input.survivorship?.firstDeathYear ?? (input.startYear ?? 2026) + 20,
        survivorSpendFrac: frac,
      });
      return;
    }
    onApplySurvivorship(s);
  };

  return (
    <div className="longevity-panel" data-testid="longevity-panel">
      <div className="panel-head" style={{ padding: "0 0 0.35rem" }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            fontSize: "1.25rem",
          }}
        >
          <GlossaryTip term="longevity">Longevity scenarios</GlossaryTip>
        </h3>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Fixed death ages and optional <GlossaryTip term="stochasticLongevity">stochastic mortality</GlossaryTip>{" "}
        trials. Uses your <strong>current strategy pins</strong> (top-up C, TFSA policy) — does not
        re-search tax strategy. Survivor spend defaults to {(frac * 100).toFixed(0)}% of couple
        lifestyle. Estimates only; not insurance or actuarial advice.
      </p>

      <label style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", marginBottom: "0.75rem" }}>
        Survivor spend
        <input
          type="number"
          min={0.4}
          max={1}
          step={0.05}
          value={frac}
          onChange={(e) => setFrac(Number(e.target.value) || 0.7)}
          style={{ width: "4.5rem" }}
          data-testid="longevity-survivor-frac"
        />
      </label>

      <h4 className="longevity-subhead">Fixed death ages</h4>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem 1.25rem",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <span className="hint" style={{ margin: 0 }}>
          Ages:
        </span>
        {AGE_PRESETS.map((age) => (
          <label key={age} style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={ages.includes(age)}
              onChange={() => toggleAge(age)}
              data-testid={`longevity-age-${age}`}
            />
            {age}
          </label>
        ))}
        <button
          type="button"
          className="btn btn-primary"
          data-testid="run-longevity"
          disabled={busy || busyMc}
          onClick={run}
        >
          {busy ? "Running scenarios…" : "Run fixed scenarios"}
        </button>
      </div>

      {result && (
        <div className="table-wrap" style={{ overflowX: "auto", marginBottom: "1.25rem" }}>
          <table className="data-table" data-testid="longevity-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Death year</th>
                <th>Funded</th>
                <th>Funded years</th>
                <th>
                  Estate <UnitBadge unit="real" />
                </th>
                <th>vs baseline</th>
                <th>Lifetime tax</th>
                <th>Survivor years</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const delta =
                  baselineEstate != null && row.estateReal != null && !row.skipped
                    ? row.estateReal - baselineEstate
                    : null;
                return (
                  <tr
                    key={row.id}
                    data-testid={`longevity-row-${row.id}`}
                    className={row.kind === "baseline" ? "longevity-baseline" : undefined}
                  >
                    <td>
                      <strong>{row.label}</strong>
                      {row.skipped && row.skipReason && (
                        <div className="hint" style={{ margin: 0, fontSize: "0.8rem" }}>
                          {row.skipReason}
                        </div>
                      )}
                    </td>
                    <td>{row.skipped ? "—" : row.firstDeathYear ?? "—"}</td>
                    <td>
                      {row.skipped
                        ? "—"
                        : row.funded
                          ? "Yes"
                          : `Short${row.firstFailureYear != null ? ` (${row.firstFailureYear})` : ""}`}
                    </td>
                    <td>{row.skipped ? "—" : row.fundedYears ?? "—"}</td>
                    <td>{row.skipped || row.estateReal == null ? "—" : money(row.estateReal)}</td>
                    <td>
                      {delta == null
                        ? "—"
                        : delta === 0
                          ? "—"
                          : `${delta > 0 ? "+" : ""}${money(delta)}`}
                    </td>
                    <td>
                      {row.skipped || row.lifetimeTax == null ? "—" : money(row.lifetimeTax)}
                    </td>
                    <td>{row.skipped ? "—" : (row.survivorYears ?? "—")}</td>
                    <td>
                      {!row.skipped && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          data-testid={`longevity-apply-${row.id}`}
                          onClick={() => apply(row)}
                        >
                          {row.kind === "baseline" ? "Clear death" : "Apply"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: "0.5rem" }}>
            Plan window {result.startYear}–{result.planEndYear}. Apply writes Household first-death
            settings — re-run <strong>Run full plan</strong> afterward.
          </p>
        </div>
      )}

      <h4 className="longevity-subhead">
        <GlossaryTip term="stochasticLongevity">Stochastic mortality</GlossaryTip>
      </h4>
      <p className="hint" style={{ marginTop: 0 }}>
        Sample independent death ages each trial (Gompertz-style hazard sketch — not a published
        life table). First death inside the plan horizon triggers survivor spend/rollover; markets
        stay on the expected path. Strategy pins held fixed.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem 1.25rem",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <label style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
          Trials
          <input
            type="number"
            min={50}
            max={2000}
            step={50}
            value={mcTrials}
            onChange={(e) => setMcTrials(Math.max(50, Number(e.target.value) || 300))}
            style={{ width: "5rem" }}
            data-testid="longevity-mc-trials"
          />
        </label>
        <label style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
          Seed
          <input
            type="number"
            min={1}
            step={1}
            value={mcSeed}
            onChange={(e) => setMcSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            style={{ width: "5rem" }}
            data-testid="longevity-mc-seed"
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="run-stochastic-longevity"
          disabled={busy || busyMc}
          onClick={runStoch}
        >
          {busyMc ? "Running mortality trials…" : "Run stochastic longevity"}
        </button>
      </div>

      {progress && (
        <p className="hint" data-testid="longevity-progress">
          {progress}
        </p>
      )}
      {err && (
        <p className="error" data-testid="longevity-error">
          {err}
        </p>
      )}

      {stoch && (
        <div className="longevity-stoch-results" data-testid="longevity-stoch-results">
          <div className="hero-metrics" style={{ marginBottom: "0.75rem" }}>
            <div className="metric">
              <div className="metric-main">
                <div className="label">Funding success</div>
                <div className="value lime" data-testid="longevity-mc-success">
                  {pct(stoch.successRate)}
                </div>
              </div>
              <div className="metric-note">
                <div className="sub">{stoch.trials} trials · seed {stoch.seed}</div>
              </div>
            </div>
            <div className="metric">
              <div className="metric-main">
                <div className="label">
                  Estate p50 <UnitBadge unit="real" />
                </div>
                <div className="value cyan" data-testid="longevity-mc-estate-p50">
                  {money(stoch.estateReal.p50)}
                </div>
              </div>
              <div className="metric-note">
                <div className="sub">
                  p10 {money(stoch.estateReal.p10, { compact: true })} · p90{" "}
                  {money(stoch.estateReal.p90, { compact: true })}
                </div>
              </div>
            </div>
            <div className="metric">
              <div className="metric-main">
                <div className="label">In-plan first death</div>
                <div className="value" data-testid="longevity-mc-death-rate">
                  {pct(stoch.inPlanDeathRate)}
                </div>
              </div>
              <div className="metric-note">
                <div className="sub">
                  {personNames[0]} first {pct(stoch.person0FirstShare)} of those
                </div>
              </div>
            </div>
            <div className="metric">
              <div className="metric-main">
                <div className="label">
                  Baseline estate <UnitBadge unit="real" />
                </div>
                <div className="value" data-testid="longevity-mc-baseline-estate">
                  {money(stoch.baselineEstateReal)}
                </div>
              </div>
              <div className="metric-note">
                <div className="sub">
                  both live · {stoch.baselineFunded ? "funded" : "short"}
                </div>
              </div>
            </div>
          </div>
          {stoch.firstDeathAge && (
            <p className="hint" data-testid="longevity-mc-death-age">
              First-death age (when in plan): p10 {stoch.firstDeathAge.p10.toFixed(0)}, p50{" "}
              {stoch.firstDeathAge.p50.toFixed(0)}, p90 {stoch.firstDeathAge.p90.toFixed(0)} ·
              mean {stoch.firstDeathAge.mean.toFixed(1)}
            </p>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            Plan window {stoch.startYear}–{stoch.planEndYear}. Independent spouse mortality; second
            death is not separately simulated after the first. {Math.round(stoch.elapsedMs)} ms.
          </p>
        </div>
      )}
    </div>
  );
}
