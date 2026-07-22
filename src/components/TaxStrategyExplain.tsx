import { useMemo } from "react";
import type { TuneResult } from "../mc";
import type { SimulationResult } from "../simulate";
import { buildStrategyWhy, buildBracketEstimates } from "../lib/taxExplain";
import { money, pct } from "../lib/format";
import { GlossaryTip } from "./GlossaryTip";
import { UnitBadge } from "./UnitBadge";

function bandRange(from: number, to: number | null): string {
  if (to == null) return `${money(from)}+`;
  return `${money(from)}–${money(to)}`;
}

export function TaxStrategyExplain({
  tune,
  result,
  personNames,
}: {
  tune: TuneResult;
  /** Usually tune.tuned; used for bracket path if provided. */
  result?: SimulationResult;
  personNames: [string, string];
}) {
  const why = useMemo(() => buildStrategyWhy(tune), [tune]);
  const path = result ?? tune.tuned;
  const brackets = useMemo(
    () => buildBracketEstimates(path, personNames, { retirementOnly: true }),
    [path, personNames]
  );

  return (
    <div className="tax-explain" data-testid="tax-strategy-explain">
      <div className="chart-wrap">
        <h3>
          Why this is the tax-minimizing path (vs{" "}
          <GlossaryTip term="naive">no meltdown</GlossaryTip>)
        </h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {why.disclaimer}
        </p>

        <div className="hero-metrics why-metrics" data-testid="tax-why-metrics">
          <div className="metric">
            <div className="metric-main">
              <div className="label">
                Living-years tax Δ <UnitBadge unit="nominal" />
              </div>
              <div className="value amber" data-testid="why-living-tax-delta">
                {money(why.livingTaxDelta)}
              </div>
            </div>
            <div className="metric-note">
              <div className="sub">naive − tuned · while alive only</div>
            </div>
          </div>
          <div className="metric">
            <div className="metric-main">
              <div className="label">
                Estate-tax Δ (implied) <UnitBadge unit="nominal" />
              </div>
              <div className="value cyan" data-testid="why-estate-tax-delta">
                {money(why.totalTaxSaving - why.livingTaxDelta)}
              </div>
            </div>
            <div className="metric-note">
              <div className="sub">
                rest of tax saved · total {money(why.totalTaxSaving)}
              </div>
            </div>
          </div>
          <div className="metric">
            <div className="metric-main">
              <div className="label">
                Estate gain <UnitBadge unit="real" />
              </div>
              <div className="value mag" data-testid="why-estate-gain">
                {money(why.estateRealGain)}
              </div>
            </div>
            <div className="metric-note">
              <div className="sub">tuned − naive · today&apos;s $</div>
            </div>
          </div>
          <div className="metric">
            <div className="metric-main">
              <div className="label">Years with top-ups</div>
              <div className="value lime" data-testid="why-topup-years-metric">
                {why.yearsWithTopUp}
              </div>
            </div>
            <div className="metric-note">
              <div className="sub">
                deliberate meltdown years · C {money(why.bestCeilingToday)}
              </div>
            </div>
          </div>
        </div>

        <div className="compare-grid" style={{ marginTop: "0.75rem" }}>
          <div className="compare-card win">
            <h3>Tuned path</h3>
            <div className="row">
              <span>Lifetime tax (living)</span>
              <span data-testid="why-tuned-tax">{money(why.tunedLifetimeTax)}</span>
            </div>
            <div className="row">
              <span>Estate (real)</span>
              <span>{money(why.tunedEstateReal)}</span>
            </div>
            <div className="row">
              <span>Years with top-ups</span>
              <span data-testid="why-topup-years">{why.yearsWithTopUp}</span>
            </div>
            <div className="row">
              <span>
                Years with <GlossaryTip term="oasZone">OAS clawback</GlossaryTip>
              </span>
              <span>{why.yearsWithOasClawbackTuned}</span>
            </div>
            <div className="row">
              <span>Peak taxable (person-year)</span>
              <span>{money(why.peakTaxableTuned)}</span>
            </div>
            <div className="row">
              <span>Share in fed 29%+ bands</span>
              <span>{pct(why.shareHighFedBracketTuned, 0)}</span>
            </div>
          </div>
          <div className="compare-card">
            <h3>Naive (C = 0)</h3>
            <div className="row">
              <span>Lifetime tax (living)</span>
              <span data-testid="why-naive-tax">{money(why.naiveLifetimeTax)}</span>
            </div>
            <div className="row">
              <span>Estate (real)</span>
              <span>{money(why.naiveEstateReal)}</span>
            </div>
            <div className="row">
              <span>Years with top-ups</span>
              <span>0</span>
            </div>
            <div className="row">
              <span>Years with OAS clawback</span>
              <span>{why.yearsWithOasClawbackNaive}</span>
            </div>
            <div className="row">
              <span>Peak taxable (person-year)</span>
              <span>{money(why.peakTaxableNaive)}</span>
            </div>
            <div className="row">
              <span>Share in fed 29%+ bands</span>
              <span>{pct(why.shareHighFedBracketNaive, 0)}</span>
            </div>
          </div>
        </div>

        <ul className="why-reasons" data-testid="tax-why-reasons">
          {why.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="chart-wrap" data-testid="future-brackets">
        <h3>Future tax-bracket estimates</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Each retirement year: <strong>taxable income (pre-split)</strong> mapped onto{" "}
          <strong>year-scaled</strong> federal and Ontario statutory brackets (CPI path). The engine
          optimizes pension income splitting for tax paid, but this table shows the pre-split taxable
          field used for band placement — bands can differ from post-split reality. One table per
          person. Statutory bands only — OAS clawback and Ontario surtax can raise the effective rate.
        </p>
        <div className="bracket-person-grid">
          {([0, 1] as const).map((pi) => (
            <PersonBracketTable
              key={pi}
              name={personNames[pi]}
              personClass={pi === 0 ? "person-a" : "person-b"}
              rows={brackets.map((y) => ({
                year: y.year,
                ...y.persons[pi],
              }))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type BracketRow = {
  year: number;
  ageDec31: number;
  taxableIncome: number;
  federal: { label: string; from: number; to: number | null };
  ontario: { label: string };
  inOasZone: boolean;
};

function PersonBracketTable({
  name,
  personClass,
  rows,
}: {
  name: string;
  personClass: "person-a" | "person-b";
  rows: BracketRow[];
}) {
  return (
    <div className={`bracket-person-panel ${personClass}`} data-testid={`brackets-${personClass}`}>
      {/* Title lives inside the scrollport so it and thead share one sticky stack (no gap bleed). */}
      <div className="bracket-table-wrap">
        <h4 className="bracket-person-title">{name}</h4>
        <table className="bracket-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Age</th>
              <th>Taxable (pre-split)</th>
              <th>Federal band</th>
              <th>Federal range (year $)</th>
              <th>Ontario band</th>
              <th>OAS zone</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} data-year={r.year}>
                <td>{r.year}</td>
                <td>{r.ageDec31}</td>
                <td>{money(r.taxableIncome)}</td>
                <td>{r.federal.label}</td>
                <td>{bandRange(r.federal.from, r.federal.to)}</td>
                <td>{r.ontario.label}</td>
                <td>{r.inOasZone ? "yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
