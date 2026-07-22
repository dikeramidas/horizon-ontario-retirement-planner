/**
 * First full calendar year for the simulation (model is annual from Jan 1).
 * If "today" is already Jan 1, that year can be used as a full year.
 * Any later date → next calendar year (next Jan 1), so mid-year runs
 * do not pretend the rest of this year is a full tax/plan year.
 */
export function defaultStartYear(now: Date = new Date()): number {
  const y = now.getFullYear();
  if (now.getMonth() === 0 && now.getDate() === 1) return y;
  return y + 1;
}
