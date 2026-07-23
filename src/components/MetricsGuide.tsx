import { useState } from "react";
import { GlossaryTip } from "./GlossaryTip";

/** A2 — How to read hero / strategy / MC numbers. */
export function MetricsGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="metrics-guide" data-testid="metrics-guide">
      <button
        type="button"
        className="metrics-guide-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Hide" : "How to read these numbers"}
      </button>
      {open && (
        <div className="metrics-guide-body">
          <ul>
            <li>
              <strong>
                <GlossaryTip term="livingTax">Lifetime tax (living)</GlossaryTip>
              </strong>{" "}
              — taxes paid while alive. Does <em>not</em> include tax on the final estate.
            </li>
            <li>
              <strong>
                <GlossaryTip term="totalTaxSaved">Tax saved vs naive</GlossaryTip>
              </strong>{" "}
              — difference in (living tax + estate tax). Do not add this on top of extra estate.
            </li>
            <li>
              <strong>
                <GlossaryTip term="estateReal">Estate (real)</GlossaryTip>
              </strong>{" "}
              — after-tax leftover at plan end in <GlossaryTip term="real">today’s $</GlossaryTip>.
              The decision metric for strategy search (after funded years).
            </li>
            <li>
              <strong>
                <GlossaryTip term="successRate">Funding / success rate</GlossaryTip>
              </strong>{" "}
              — after a market stress test: share of random paths that never miss spending. Median
              under volatility is usually below the smooth expected-return path. Estate note shows{" "}
              <strong>worse (p10)</strong> and <strong>better case (p90)</strong> when MC has run.
            </li>
            <li>
              <strong>
                <GlossaryTip term="estateTax">Estate tax at death</GlossaryTip>
              </strong>{" "}
              — terminal tax on registered accounts / gains (nominal). Not the same as real after-tax
              estate.
            </li>
            <li>
              <strong>
                <GlossaryTip term="naive">Naive baseline</GlossaryTip>
              </strong>{" "}
              — same household with no{" "}
              <GlossaryTip term="meltdown">meltdown</GlossaryTip> (
              <GlossaryTip term="topUpCeiling">C = 0</GlossaryTip>).
            </li>
            <li>
              <strong>Not pure tax minimization</strong> — full-plan search prioritizes funded
              years, then real after-tax estate. Meltdown often raises living-year tax while
              reducing estate tax.
            </li>
            <li>
              <strong>
                <GlossaryTip term="nominal">Nominal</GlossaryTip> vs{" "}
                <GlossaryTip term="real">real</GlossaryTip>
              </strong>{" "}
              — year-by-year cashflow and balances charts are usually nominal; estate and the real
              net-worth chart are today’s $.
            </li>
          </ul>
          <p className="hint" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            Deeper write-up:{" "}
            <a
              href="https://github.com/dikeramidas/horizon-ontario-retirement-planner/blob/main/docs/tax-minimization-memo.md"
              target="_blank"
              rel="noreferrer"
              data-testid="metrics-guide-tax-memo"
            >
              lifetime multi-account tax memo
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
