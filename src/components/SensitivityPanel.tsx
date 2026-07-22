import { useState } from "react";
import type { HouseholdInput } from "../simulate";
import { runSensitivityTornado, type SensitivityResult } from "../lib/sensitivity";
import { money } from "../lib/format";
import { UnitBadge } from "./UnitBadge";

export function SensitivityPanel({ input }: { input: HouseholdInput }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SensitivityResult | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    await new Promise((r) => setTimeout(r, 20));
    try {
      setResult(runSensitivityTornado(input, { quick: true }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const maxAbs = result
    ? Math.max(
        1,
        ...result.bars.flatMap((b) => [Math.abs(b.downDelta), Math.abs(b.upDelta)])
      )
    : 1;

  return (
    <div className="sensitivity-panel" data-testid="sensitivity-panel">
      <h3 style={{ margin: "0 0 0.35rem", fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem" }}>
        Sensitivity (tornado)
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        How real after-tax estate moves when key assumptions change (expected path, quick strategy
        retune). Bars: left = downside case, right = upside.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        data-testid="run-sensitivity"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? "Running…" : "Run sensitivity"}
      </button>
      {err && <p className="error-banner">{err}</p>}
      {result && (
        <div style={{ marginTop: "0.75rem" }} data-testid="sensitivity-result">
          <p className="hint">
            Base estate <UnitBadge unit="real" />:{" "}
            <strong>{money(result.baseEstateReal)}</strong>
            {result.baseFunded ? "" : " · base path short"}
          </p>
          <div className="tornado">
            {result.bars.map((b) => (
              <div className="tornado-row" key={b.id} data-testid={`sens-${b.id}`}>
                <div className="tornado-label">{b.label}</div>
                <div className="tornado-bars">
                  <div className="tornado-half left">
                    <div
                      className="tornado-fill down"
                      style={{ width: `${(Math.abs(b.downDelta) / maxAbs) * 50}%` }}
                      title={b.downLabel}
                    />
                    <span className="tornado-delta">{money(b.downDelta, { compact: true })}</span>
                  </div>
                  <div className="tornado-mid" />
                  <div className="tornado-half right">
                    <div
                      className="tornado-fill up"
                      style={{ width: `${(Math.abs(b.upDelta) / maxAbs) * 50}%` }}
                      title={b.upLabel}
                    />
                    <span className="tornado-delta">{money(b.upDelta, { compact: true })}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
