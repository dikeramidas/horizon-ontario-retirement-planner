import type { HouseholdInput, SimulationResult } from "../simulate";
import type { MonteCarloResult } from "../mc";
import {
  needsShortfallHelp,
  suggestShortfallLevers,
  type ShortfallLever,
} from "../lib/shortfallLevers";
import { pct } from "../lib/format";

export function ShortfallPanel({
  input,
  det,
  mc,
  onApply,
}: {
  input: HouseholdInput;
  det: SimulationResult | null | undefined;
  mc: MonteCarloResult | null | undefined;
  onApply: (next: HouseholdInput, lever: ShortfallLever) => void;
}) {
  if (!needsShortfallHelp(det, mc)) return null;
  const levers = suggestShortfallLevers(input, det, mc);
  const reason = det?.failedAnyYear
    ? `Expected path runs short${det.firstFailureYear != null ? ` (first miss ${det.firstFailureYear})` : ""}.`
    : mc
      ? `Market stress success is ${pct(mc.successRate, 0)} — below a common 85% comfort line.`
      : "Plan needs attention.";

  return (
    <div className="shortfall-panel" data-testid="shortfall-panel">
      <h3>Ways to close the gap</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {reason} Try a lever, then <strong>Run full plan</strong> again. Estimates only — not advice.
      </p>
      <ul className="shortfall-levers">
        {levers.map((L) => (
          <li key={L.id}>
            <div className="shortfall-lever-text">
              <strong>{L.label}</strong>
              <span className="hint">{L.detail}</span>
            </div>
            <button
              type="button"
              className="btn"
              data-testid={`lever-${L.id}`}
              onClick={() => onApply(L.apply(input), L)}
            >
              Apply
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
