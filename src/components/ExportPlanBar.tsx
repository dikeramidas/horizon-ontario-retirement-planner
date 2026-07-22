import type { HouseholdInput, SimulationResult } from "../simulate";
import type { MonteCarloResult, TuneResult } from "../mc";
import {
  buildCashflowCsv,
  buildExportHtml,
  downloadTextFile,
  openPrintSummary,
} from "../lib/exportPlan";

export function ExportPlanBar({
  input,
  personNames,
  det,
  tune,
  mc,
}: {
  input: HouseholdInput;
  personNames: [string, string];
  det: SimulationResult | null;
  tune: TuneResult | null;
  mc: MonteCarloResult | null;
}) {
  if (!det && !tune) return null;

  const ctx = { input, personNames, det, tune, mc };

  return (
    <div className="export-plan-bar" data-testid="export-plan-bar">
      <span className="hint" style={{ margin: 0 }}>
        Export (stays on this device):
      </span>
      <button
        type="button"
        className="btn"
        data-testid="export-print"
        onClick={() => openPrintSummary(ctx)}
      >
        Print / PDF summary
      </button>
      <button
        type="button"
        className="btn"
        data-testid="export-html"
        onClick={() =>
          downloadTextFile(
            `horizon-summary-${Date.now()}.html`,
            buildExportHtml(ctx),
            "text/html;charset=utf-8"
          )
        }
      >
        Download HTML
      </button>
      {det && (
        <button
          type="button"
          className="btn"
          data-testid="export-csv"
          onClick={() =>
            downloadTextFile(
              `horizon-cashflow-${Date.now()}.csv`,
              buildCashflowCsv(det),
              "text/csv;charset=utf-8"
            )
          }
        >
          Cashflow CSV
        </button>
      )}
    </div>
  );
}
