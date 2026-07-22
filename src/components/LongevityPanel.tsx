import { useMemo, useState } from "react";
import type { HouseholdInput } from "../simulate";
import {
  DEFAULT_LONGEVITY_AGES,
  runLongevityScenarios,
  survivorshipFromRow,
  type LongevityScenarioResult,
  type LongevityScenarioRow,
} from "../lib/longevityScenarios";
import { money } from "../lib/format";
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
  const [result, setResult] = useState<LongevityScenarioResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const toggleAge = (age: number) => {
    setAges((prev) => {
      if (prev.includes(age)) {
        const next = prev.filter((a) => a !== age);
        return next.length ? next : prev; // keep at least one
      }
      return [...prev, age].sort((a, b) => a - b);
    });
  };

  const run = () => {
    setBusy(true);
    setErr(null);
    setProgress("Running…");
    // Yield so the button can paint busy state before heavy simulate work
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
        Compare the expected path if both of you live to the plan horizon versus if one spouse dies
        first at selected ages. Uses your <strong>current strategy pins</strong> (top-up C, TFSA
        policy) — it does not re-search tax strategy per row. Survivor spending step-down defaults
        to {(frac * 100).toFixed(0)}% of the couple lifestyle. Estimates only; not insurance or
        estate advice.
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
        <span className="hint" style={{ margin: 0 }}>
          Death ages:
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
        <label style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
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
        <button
          type="button"
          className="btn btn-primary"
          data-testid="run-longevity"
          disabled={busy}
          onClick={run}
        >
          {busy ? "Running scenarios…" : "Run longevity scenarios"}
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

      {result && (
        <div className="table-wrap" style={{ overflowX: "auto" }}>
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
                          title={
                            row.kind === "baseline"
                              ? "Turn off first-death modeling on the plan"
                              : "Set Household → first death to this scenario"
                          }
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
            Plan window {result.startYear}–{result.planEndYear}. Names: {personNames[0]} /{" "}
            {personNames[1]}. Apply writes Household first-death settings — re-run{" "}
            <strong>Run full plan</strong> to refresh the main path.
          </p>
        </div>
      )}
    </div>
  );
}
