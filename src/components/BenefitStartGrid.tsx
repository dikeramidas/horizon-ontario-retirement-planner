import { useRef, useState } from "react";
import type { HouseholdInput } from "../simulate";
import {
  applyBenefitStarts,
  runBenefitStartGrid,
  type BenefitStartGridResult,
  type BenefitStartCell,
} from "../lib/benefitStartGrid";
import { money } from "../lib/format";
import { UnitBadge } from "./UnitBadge";
import type { ProgressEvent } from "../lib/progress";

export function BenefitStartGridPanel({
  input,
  onApply,
}: {
  input: HouseholdInput;
  onApply: (next: HouseholdInput, cell: BenefitStartCell) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [result, setResult] = useState<BenefitStartGridResult | null>(null);
  const cancelRef = useRef(false);

  const run = async () => {
    cancelRef.current = false;
    setBusy(true);
    setErr(null);
    setProgress({ phase: "start", fraction: 0, detail: "Starting CPP/OAS grid…" });
    await new Promise((r) => setTimeout(r, 20));
    try {
      // Main-thread grid (6 quick analyzes); yield via setTimeout is enough for UI paint
      const res = runBenefitStartGrid(input, {
        quick: true,
        onProgress: (p) => {
          if (!cancelRef.current) setProgress(p);
        },
      });
      if (!cancelRef.current) setResult(res);
    } catch (e) {
      if (!cancelRef.current) setErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="benefit-grid-panel" data-testid="benefit-start-grid">
      <h3 style={{ margin: "0 0 0.35rem", fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.25rem" }}>
        CPP / OAS start ages
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Small grid: CPP at 60 / 65 / 70 × OAS at 65 / 70, applied to <strong>both</strong> spouses.
        Each cell re-tunes the tax-aware ceiling on the expected path. Recommendation maximizes
        funded years, then real estate, then lower lifetime tax.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="run-benefit-grid"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? "Running grid…" : "Run start-age grid"}
        </button>
      </div>
      {busy && progress && (
        <p className="hint" data-testid="benefit-grid-progress">
          {progress.detail}
        </p>
      )}
      {err && <p className="error-banner">{err}</p>}
      {result && (
        <>
          <p className="hint" data-testid="benefit-grid-rec">
            Recommended: <strong>CPP {result.recommended.cppStartAge}</strong> ·{" "}
            <strong>OAS {result.recommended.oasStartAge}</strong>
            {" — "}
            {result.recommended.scoreLabel}
          </p>
          <div className="table-scroll" style={{ maxHeight: "none", marginTop: "0.5rem" }}>
            <table className="cash compare-table" data-testid="benefit-grid-table">
              <thead>
                <tr>
                  <th>CPP</th>
                  <th>OAS</th>
                  <th>Funded</th>
                  <th>
                    Estate <UnitBadge unit="real" />
                  </th>
                  <th>
                    Lifetime tax <UnitBadge unit="nominal" />
                  </th>
                  <th>C</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {result.cells.map((c) => {
                  const isRec =
                    c.cppStartAge === result.recommended.cppStartAge &&
                    c.oasStartAge === result.recommended.oasStartAge;
                  const isCur =
                    c.cppStartAge === result.current.cppStartAge &&
                    c.oasStartAge === result.current.oasStartAge;
                  return (
                    <tr
                      key={`${c.cppStartAge}-${c.oasStartAge}`}
                      className={isRec ? "row-rec" : isCur ? "row-cur" : undefined}
                      data-recommended={isRec || undefined}
                    >
                      <td>{c.cppStartAge}</td>
                      <td>{c.oasStartAge}</td>
                      <td>
                        {c.funded
                          ? "Yes"
                          : `Short${c.firstFailureYear != null ? ` ${c.firstFailureYear}` : ""}`}
                      </td>
                      <td>{money(c.estateReal)}</td>
                      <td>{money(c.lifetimeTax)}</td>
                      <td>{money(c.bestCeilingToday)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          data-testid={`apply-benefit-${c.cppStartAge}-${c.oasStartAge}`}
                          onClick={() =>
                            onApply(applyBenefitStarts(input, c.cppStartAge, c.oasStartAge), c)
                          }
                        >
                          Apply
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Highlight: recommended row · current form ages when they match a cell. Apply updates both
            spouses; run full plan again to refresh results.
          </p>
        </>
      )}
    </div>
  );
}
