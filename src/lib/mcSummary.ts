import type { MonteCarloResult } from "../mc";

/**
 * Modal first-failure year among trials that failed (highest count in failures[]).
 * Returns null if no failures (100% success) or empty list.
 * Tie-break: earlier year wins (more conservative / clearer "when it starts breaking").
 */
export function typicalFirstShortfallYear(
  failures: MonteCarloResult["failures"]
): number | null {
  if (!failures.length) return null;
  let bestYear = failures[0].year;
  let bestCount = failures[0].count;
  for (let i = 1; i < failures.length; i++) {
    const { year, count } = failures[i];
    if (count > bestCount || (count === bestCount && year < bestYear)) {
      bestCount = count;
      bestYear = year;
    }
  }
  if (bestCount <= 0) return null;
  return bestYear;
}

/** Share of trials that failed at least once (0..1). */
export function failureRate(mc: Pick<MonteCarloResult, "successRate">): number {
  return Math.max(0, Math.min(1, 1 - mc.successRate));
}

export function countFailingTrials(failures: MonteCarloResult["failures"]): number {
  return failures.reduce((s, f) => s + f.count, 0);
}
