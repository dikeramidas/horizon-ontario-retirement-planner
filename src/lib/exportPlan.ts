/**
 * A6 — Client-side export: print-friendly HTML summary + CSV of year rows.
 */
import type { HouseholdInput, SimulationResult } from "../simulate";
import type { MonteCarloResult, TuneResult } from "../mc";
import { cashflowSeries } from "./cashflow";
import { estateTaxOf } from "./estateTax";
import { resolveTfsaLevel } from "./tfsaPolicy";
import { POLICY_BASELINE } from "../constants-2026";

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

/** Self-contained HTML for print / save-as-PDF from the browser. */
export function buildExportHtml(ctx: ExportPlanContext): string {
  const when = ctx.generatedAt ?? new Date().toISOString();
  const h = ctx.input;
  const primary = ctx.det ?? ctx.tune?.tuned ?? null;
  const naive = ctx.tune?.naive ?? null;

  const rows: Array<[string, string]> = [
    ["Generated", when],
    ["Policy baseline", `${POLICY_BASELINE.taxYear} (${POLICY_BASELINE.jurisdiction}, retrieved ${POLICY_BASELINE.retrievedOn})`],
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
    ["Top-up ceiling C (today's $)", moneyPlain(ctx.tune?.bestCeilingToday ?? h.strategy?.topUpCeilingToday ?? 0)],
  ];

  if (primary) {
    rows.push(
      ["Funded (expected path)", primary.failedAnyYear ? `Short ${primary.firstFailureYear ?? ""}` : "Yes"],
      ["Lifetime tax (living, nominal)", moneyPlain(primary.lifetimeTax)],
      ["Estate tax at death (nominal)", moneyPlain(estateTaxOf(primary))],
      ["After-tax estate (real)", moneyPlain(primary.afterTaxEstateReal)]
    );
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
      ["MC estate p10 / p50 / p90 (real)", `${moneyPlain(ctx.mc.estateReal.p10)} / ${moneyPlain(ctx.mc.estateReal.p50)} / ${moneyPlain(ctx.mc.estateReal.p90)}`]
    );
  }

  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Horizon plan summary</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #111; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    .tag { color: #444; font-size: 0.9rem; margin-bottom: 1.25rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { width: 40%; color: #333; font-weight: 600; }
    .disclaimer { margin-top: 1.5rem; padding: 0.75rem 1rem; background: #f6f6f6; border-radius: 8px; font-size: 0.85rem; color: #333; }
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>Horizon — plan summary</h1>
  <p class="tag">Ontario couple retirement · estimates only · not financial, tax, or legal advice</p>
  <p class="no-print"><button onclick="window.print()">Print / Save as PDF</button></p>
  <table>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <div class="disclaimer">
    Outputs are planning estimates from Horizon’s client-side engine. Tax rules are simplified
    (see in-app policy baseline ${POLICY_BASELINE.taxYear}). Re-run analysis after material input changes.
  </div>
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
    // Popup blocked — fall back to download
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
