/** Shared chart horizontal-axis helpers (calendar year labels). */

/** Pick a year step so the axis gets ~5–8 labels (1 / 2 / 5 / 10 / 20…). */
export function yearAxisStep(yearCount: number): number {
  if (yearCount <= 1) return 1;
  // Common retirement horizons: 5-year ticks read best
  if (yearCount >= 15 && yearCount <= 60) return 5;
  const target = 6;
  const nice = [1, 2, 5, 10, 20, 25, 50];
  let best = 1;
  let bestScore = Infinity;
  for (const s of nice) {
    const n = Math.floor((yearCount - 1) / s) + 1;
    const score = Math.abs(n - target) + (n > 10 ? (n - 10) * 2 : 0) + (n < 3 ? 3 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** Year labels: start, every `step` years on a round calendar grid when possible, and end. */
export function yearAxisLabels(startYear: number, yearCount: number): number[] {
  if (yearCount <= 0) return [];
  if (yearCount === 1) return [startYear];
  const endYear = startYear + yearCount - 1;
  const step = yearAxisStep(yearCount);
  const labels: number[] = [startYear];
  // First tick at or after start that lands on a step-aligned year (e.g. 2030, 2035…)
  let y = Math.ceil(startYear / step) * step;
  if (y === startYear) y += step;
  for (; y < endYear; y += step) labels.push(y);
  if (labels[labels.length - 1] !== endYear) labels.push(endYear);
  // Drop a mid label if it crowds the end (within ~40% of a step)
  if (labels.length >= 3) {
    const lastGap = labels[labels.length - 1] - labels[labels.length - 2];
    if (lastGap < step * 0.45) {
      labels.splice(labels.length - 2, 1);
    }
  }
  return labels;
}
