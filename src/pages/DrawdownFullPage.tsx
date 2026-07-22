import { useEffect, useMemo, useState } from "react";
import type { HouseholdInput, SimulationResult } from "../simulate";
import { retirementDrawdown } from "../lib/drawdown";
import { analyzePlan } from "../lib/analysis";
import { sampleHousehold } from "../lib/sampleHousehold";
import { loadLastPlan } from "../lib/lastPlanStore";
import type { DrawdownFullMode } from "../lib/hashRoute";
import { WithdrawalsYearTable, BalancesYearTable } from "../components/DrawdownTables";

export function DrawdownFullPage({
  mode,
  result,
  personNames,
  onResult,
}: {
  mode: DrawdownFullMode;
  result: SimulationResult | null;
  personNames: [string, string];
  /** When parent has no result yet, compute and push back (optional). */
  onResult?: (r: SimulationResult, names: [string, string], input: HouseholdInput) => void;
}) {
  const [local, setLocal] = useState<SimulationResult | null>(result);
  const [names, setNames] = useState(personNames);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLocal(result);
  }, [result]);

  useEffect(() => {
    setNames(personNames);
  }, [personNames]);

  useEffect(() => {
    if (local || result) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    // Yield so the loading line paints
    const t = window.setTimeout(() => {
      try {
        const snap = loadLastPlan();
        const input = snap?.input ?? sampleHousehold();
        const n: [string, string] = snap?.personNames ?? [
          input.persons[0].name || "Spouse A",
          input.persons[1].name || "Spouse B",
        ];
        const a = analyzePlan(input, { quick: true });
        if (cancelled) return;
        setLocal(a.primary);
        setNames(n);
        onResult?.(a.primary, n, {
          ...input,
          strategy: { ...input.strategy, topUpCeilingToday: a.bestCeilingToday },
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [local, result, onResult]);

  const active = local ?? result;
  const years = useMemo(
    () => (active ? retirementDrawdown(active, names) : []),
    [active, names]
  );

  const title = mode === "withdrawals" ? "Withdrawals by year" : "Balances by year";
  const otherHref =
    mode === "withdrawals" ? "#/drawdown/balances" : "#/drawdown/withdrawals";
  const otherLabel =
    mode === "withdrawals" ? "Balances table" : "Withdrawals table";

  return (
    <div className="drawdown-full" data-testid="drawdown-full-page" data-mode={mode}>
      <header className="drawdown-full-bar">
        <div>
          <div className="brand-mark">Horizon · full table</div>
          <h1 className="drawdown-full-title">{title}</h1>
          <p className="hint" style={{ margin: "0.35rem 0 0" }}>
            One row per year · columns by person · browser scroll (no nested box)
          </p>
        </div>
        <div className="drawdown-full-actions">
          <a href="#/" className="btn btn-primary" data-testid="link-back-planner">
            ← Back to planner
          </a>
          <a href={otherHref} className="btn" data-testid="link-switch-drawdown">
            {otherLabel}
          </a>
        </div>
      </header>

      <div className="disclaimer" role="note">
        <div>
          <strong>Estimates · not advice</strong>
          <div>Planning figures from the analyzed path. Not financial or tax advice.</div>
        </div>
      </div>

      {busy && (
        <p className="status-pill busy pulse" data-testid="drawdown-full-loading">
          Loading plan…
        </p>
      )}
      {err && (
        <p className="status-pill err" data-testid="drawdown-full-error">
          {err}
        </p>
      )}

      {years.length > 0 && mode === "withdrawals" && (
        <WithdrawalsYearTable years={years} personNames={names} fullPage />
      )}
      {years.length > 0 && mode === "balances" && (
        <BalancesYearTable years={years} personNames={names} fullPage />
      )}

      {years.length > 0 && (
        <p className="footer-note" data-testid="drawdown-full-rowcount">
          {years.length} retirement years · {names[0]} & {names[1]}
        </p>
      )}
    </div>
  );
}
