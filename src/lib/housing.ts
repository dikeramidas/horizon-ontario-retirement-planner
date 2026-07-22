/** B5 — primary residence growth / sale / estate. */
import type { HousingSpec } from "../simulate";

export function housingValueNominal(
  housing: HousingSpec | undefined,
  yearsFromStart: number,
  cpi: number
): number {
  if (!housing?.enabled || housing.valueToday <= 0) return 0;
  const g = housing.realGrowth ?? 0.01;
  return housing.valueToday * cpi * Math.pow(1 + g, Math.max(0, yearsFromStart));
}

export function shouldSellHousing(housing: HousingSpec | undefined, year: number): boolean {
  return !!(housing?.enabled && housing.sellYear != null && housing.sellYear === year);
}

export function includeHousingInEstate(housing: HousingSpec | undefined, sold: boolean): boolean {
  if (!housing?.enabled) return false;
  if (sold) return false;
  return housing.includeInEstate !== false;
}
