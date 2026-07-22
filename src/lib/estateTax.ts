/** Terminal estate tax embedded in SimulationResult (gross − after-tax estate). */

export function estateTaxOf(r: {
  finalBalances: { total: number };
  afterTaxEstate: number;
}): number {
  return Math.max(0, r.finalBalances.total - r.afterTaxEstate);
}
