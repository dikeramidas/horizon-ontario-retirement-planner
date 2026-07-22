import { useRef, useState } from "react";
import type { HouseholdInput } from "../simulate";
import type { TuneResult } from "../mc";
import type { SpendToZeroResult } from "../lib/spendToZero";
import { findMaxSpendToZeroAsync, EngineJobCancelled } from "../lib/engineClient";
import { money } from "../lib/format";
import { GlossaryTip } from "./GlossaryTip";
import { UnitBadge } from "./UnitBadge";
import type { ProgressEvent } from "../lib/progress";

export function SpendToZeroPanel({
  input,
  onApplySpend,
}: {
  input: HouseholdInput;
  /** Present when a full plan has been run (panel is only shown then). */
  tune?: TuneResult | null;
  onApplySpend: (spend: number, meta: SpendToZeroResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SpendToZeroResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setErr(null);
    setProgress({ phase: "start", fraction: 0, detail: "Starting spend search…" });
    try {
      const res = await findMaxSpendToZeroAsync(
        input,
        {
          estateEps: 50_000,
          analyzeOpts: { quick: true },
          retuneStrategy: true,
        },
        { signal: ac.signal, onProgress: setProgress }
      );
      setResult(res);
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
    <div className="spend-to-zero-panel" data-testid="spend-to-zero-panel">
      <div className="panel-head" style={{ padding: "0 0 0.35rem" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.25rem" }}>
          <GlossaryTip term="spendToZero">Suggested max lifestyle</GlossaryTip>
        </h3>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Search for the highest annual spend <UnitBadge unit="real" /> that still funds every year on
        the expected path. At each trial the tax-aware top-up ceiling is <strong>re-optimized</strong>{" "}
        for that lifestyle (not frozen from your current spend). Aims for little leftover estate — not
        a promise of zero. Runs off the main thread; cancel anytime.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="run-spend-to-zero"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? "Searching spend…" : "Suggest max spend"}
        </button>
        {busy && (
          <button
            type="button"
            className="btn btn-danger"
            data-testid="cancel-spend-to-zero"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </button>
        )}
      </div>
      {busy && progress && (
        <p className="hint" data-testid="stz-progress" style={{ marginTop: "0.5rem" }}>
          {progress.detail}
          {progress.fraction != null ? ` · ${Math.round(progress.fraction * 100)}%` : ""}
        </p>
      )}
      {err && <p className="error-banner">{err}</p>}
      {result && (
        <div className="spend-to-zero-result" data-testid="spend-to-zero-result">
          <div className="row">
            <span>Suggested spend</span>
            <span className="big" style={{ color: "var(--lime)" }} data-testid="stz-spend">
              {money(result.maxSpendToday)}
            </span>
          </div>
          <div className="row">
            <span>
              Estate at that spend <UnitBadge unit="real" />
            </span>
            <span data-testid="stz-estate">{money(result.estateReal)}</span>
          </div>
          <div className="row">
            <span>Top-up C used</span>
            <span>{money(result.ceilingUsed)}</span>
          </div>
          <p className="hint">{result.summary}</p>
          <button
            type="button"
            className="btn"
            data-testid="apply-stz-spend"
            disabled={!result.funded && result.failedAnyYear}
            onClick={() => onApplySpend(result.maxSpendToday, result)}
          >
            Apply spend to form
          </button>
        </div>
      )}
    </div>
  );
}
