/**
 * A6 — Client-side export: print-friendly HTML summary + CSV of year rows.
 */
import type { HouseholdInput, SimulationResult } from "../simulate";
import type { MonteCarloResult, TuneResult } from "../mc";
import { cashflowSeries } from "./cashflow";
import { estateTaxOf } from "./estateTax";
import { resolveTfsaLevel } from "./tfsaPolicy";
import { POLICY_BASELINE } from "../constants-2026";
import { APP_RELEASE_LABEL, APP_TAGLINE } from "./appMeta";

export interface ExportPlanContext {
  input: HouseholdInput;
  personNames: [string, string];
  det: SimulationResult | null;
  tune: TuneResult | null;
  mc: MonteCarloResult | null;
  generatedAt?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moneyPlain(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

function pctPlain(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** CSV of retirement cashflow years (nominal). */
export function buildCashflowCsv(det: SimulationResult): string {
  const rows = cashflowSeries(det, true);
  const header = [
    "year",
    "salary",
    "cpp",
    "oas",
    "db",
    "unregistered",
    "registered",
    "lif",
    "tfsa",
    "topUp",
    "tax",
    "spending",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const nums = [
      r.salary,
      r.cpp,
      r.oas,
      r.db,
      r.unregistered,
      r.registered,
      r.lif,
      r.tfsa,
      r.topUp,
      r.tax,
      r.spending,
    ].map((x) => x.toFixed(2));
    lines.push([String(r.year), ...nums].join(","));
  }
  return lines.join("\n");
}

/** Self-contained branded HTML for print / Save as PDF from the browser. */
export function buildExportHtml(ctx: ExportPlanContext): string {
  const when = ctx.generatedAt ?? new Date().toISOString();
  const h = ctx.input;
  const primary = ctx.det ?? ctx.tune?.tuned ?? null;
  const naive = ctx.tune?.naive ?? null;

  const rows: Array<[string, string]> = [
    ["Generated", when],
    ["App version", APP_RELEASE_LABEL],
    [
      "Policy baseline",
      `${POLICY_BASELINE.taxYear} (${POLICY_BASELINE.jurisdiction}, retrieved ${POLICY_BASELINE.retrievedOn})`,
    ],
    ["Start year", String(h.startYear ?? "—")],
    ["Spending target (today's $)", moneyPlain(h.spendingTargetToday)],
    ["Inflation", pctPlain(h.inflation ?? 0)],
    ["Horizon (younger spouse age)", String(h.horizonAgeYoungerSpouse ?? 95)],
    [
      "Spouses",
      `${ctx.personNames[0]} (ret ${h.persons[0].retirementAge}, b.${h.persons[0].birthYear}) · ${ctx.personNames[1]} (ret ${h.persons[1].retirementAge}, b.${h.persons[1].birthYear})`,
    ],
    [
      "CPP / OAS starts",
      `CPP ${h.persons[0].cpp?.startAge ?? "—"} / ${h.persons[1].cpp?.startAge ?? "—"} · OAS ${h.persons[0].oas?.startAge ?? "—"} / ${h.persons[1].oas?.startAge ?? "—"}`,
    ],
    ["TFSA policy", resolveTfsaLevel(h.strategy?.tfsaLevel)],
    [
      "Top-up ceiling C (today's $)",
      moneyPlain(ctx.tune?.bestCeilingToday ?? h.strategy?.topUpCeilingToday ?? 0),
    ],
  ];

  if (primary) {
    rows.push(
      ["Funded (expected path)", primary.failedAnyYear ? `Short ${primary.firstFailureYear ?? ""}` : "Yes"],
      ["Lifetime tax (living, nominal)", moneyPlain(primary.lifetimeTax)],
      ["Estate tax at death (nominal)", moneyPlain(estateTaxOf(primary))],
      ["After-tax estate (real)", moneyPlain(primary.afterTaxEstateReal)]
    );
    if (primary.estateAdminTaxReal != null && primary.estateAdminTaxReal > 0) {
      rows.push([
        "Ontario EAT sketch (real, upper-bound)",
        moneyPlain(primary.estateAdminTaxReal),
      ]);
    }
  }
  if (ctx.tune && naive) {
    rows.push(
      ["Naive lifetime tax", moneyPlain(naive.lifetimeTax)],
      ["Naive estate (real)", moneyPlain(naive.afterTaxEstateReal)],
      ["Tax saved vs naive (living+estate)", moneyPlain(ctx.tune.totalTaxSaving)],
      ["Extra estate from strategy (real)", moneyPlain(ctx.tune.estateRealGain)]
    );
  }
  if (ctx.mc) {
    rows.push(
      ["MC trials / seed", `${ctx.mc.trials} / ${ctx.mc.seed}`],
      ["MC success rate", pctPlain(ctx.mc.successRate)],
      [
        "MC estate p10 / p50 / p90 (real)",
        `${moneyPlain(ctx.mc.estateReal.p10)} / ${moneyPlain(ctx.mc.estateReal.p50)} / ${moneyPlain(ctx.mc.estateReal.p90)}`,
      ]
    );
  }

  const tableRows = rows
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Horizon ${esc(APP_RELEASE_LABEL)} — plan summary</title>
  <style>
    :root {
      --ink: #12141c;
      --muted: #5a6070;
      --line: #e4e6ee;
      --lime: #9bbb2a;
      --cyan: #1a9fb5;
      --paper: #fafbfc;
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      color: var(--ink);
      max-width: 820px;
      margin: 0 auto;
      padding: 0 1.25rem 2.5rem;
      line-height: 1.5;
      background: #fff;
    }
    .masthead {
      margin: 0 -1.25rem 1.5rem;
      padding: 1.35rem 1.25rem 1.15rem;
      background: linear-gradient(135deg, #0b0d14 0%, #161a28 55%, #1a2438 100%);
      color: #e8eaf6;
    }
    .masthead .mark {
      font-size: 0.72rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #c8f542;
      font-weight: 600;
      margin: 0 0 0.35rem;
    }
    .masthead h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-weight: 400;
      font-size: 1.85rem;
      margin: 0 0 0.35rem;
      letter-spacing: -0.02em;
    }
    .masthead h1 em {
      font-style: italic;
      color: #c8f542;
    }
    .masthead .sub {
      margin: 0;
      color: rgba(232,234,246,0.72);
      font-size: 0.9rem;
    }
    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.85rem 0 0;
    }
    .badge {
      font-size: 0.72rem;
      padding: 0.2rem 0.5rem;
      border-radius: 999px;
      border: 1px solid rgba(200,245,66,0.35);
      color: #c8f542;
    }
    h2 {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 1.5rem 0 0.5rem;
    }
    table { width: 100%; border-collapse: collapse; margin: 0.25rem 0 1rem; }
    th, td {
      text-align: left;
      padding: 0.45rem 0.55rem;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      font-size: 0.92rem;
    }
    th { width: 42%; color: var(--muted); font-weight: 600; }
    .actions {
      margin: 1rem 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .actions button {
      font: inherit;
      padding: 0.5rem 0.9rem;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--paper);
      cursor: pointer;
    }
    .actions button.primary {
      background: #0b0d14;
      color: #c8f542;
      border-color: #0b0d14;
    }
    .disclaimer {
      margin-top: 1.75rem;
      padding: 0.9rem 1rem;
      background: var(--paper);
      border-radius: 10px;
      border-left: 3px solid var(--lime);
      font-size: 0.85rem;
      color: #333;
    }
    .footer {
      margin-top: 1.25rem;
      font-size: 0.78rem;
      color: var(--muted);
    }
    @media print {
      body { margin: 0; padding: 0 0.5in 0.5in; max-width: none; }
      .masthead { margin: 0 0 1rem; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .actions { display: none !important; }
    }
  </style>
</head>
<body>
  <header class="masthead">
    <p class="mark">Ontario · couple · lifecycle</p>
    <h1><em>Horizon</em> plan summary</h1>
    <p class="sub">${esc(APP_TAGLINE)} · ${esc(APP_RELEASE_LABEL)}</p>
    <div class="badge-row">
      <span class="badge">Estimates only</span>
      <span class="badge">Not advice</span>
      <span class="badge">Client-side</span>
    </div>
  </header>

  <div class="actions no-print">
    <button type="button" class="primary" onclick="window.print()">Print / Save as PDF</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>

  <h2>Plan snapshot</h2>
  <table>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="disclaimer">
    <strong>Estimates · not advice.</strong>
    Outputs are planning estimates from Horizon’s client-side engine under simplified
    Canadian tax rules (Ontario + federal ${POLICY_BASELINE.taxYear} baseline).
    Not financial, tax, or legal advice. Re-run analysis after material input changes.
    Confirm decisions with a qualified professional.
  </div>
  <p class="footer">Generated ${esc(when)} · Horizon ${esc(APP_RELEASE_LABEL)}</p>
</body>
</html>`;
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openPrintSummary(ctx: ExportPlanContext): void {
  const html = buildExportHtml(ctx);
  const w = window.open("", "_blank");
  if (!w) {
    downloadTextFile(
      `horizon-summary-${Date.now()}.html`,
      html,
      "text/html;charset=utf-8"
    );
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
