/**
 * GIS (Guaranteed Income Supplement) sketch for OAS recipients.
 * Not full CRA quarterly tables — annual, CPI-scaled maxima with a 50% reduction
 * for other income (excluding OAS/GIS). Couples both on OAS use the lower
 * partner maximum and a combined-income reduction.
 */
import { GIS } from "../constants-2026";

export interface GisInput {
  oasGross: number;
  /** Income excluding OAS and GIS (salary, CPP, pensions, investment, etc.). */
  otherIncome: number;
  /** True when the spouse also has OAS in pay this year. */
  spouseHasOas: boolean;
  spouseOtherIncome: number;
  cpi: number;
}

/**
 * Annual GIS estimate for one person. Zero if no OAS.
 */
export function estimateGis(p: GisInput): number {
  if (p.oasGross <= 0) return 0;
  const cpi = Math.max(0, p.cpi);

  if (p.spouseHasOas) {
    // Partnered max; combined other income reduces GIS (shared 50% rate on total)
    const max = GIS.maxAnnualPartner.value * cpi;
    const combinedOther = Math.max(0, p.otherIncome) + Math.max(0, p.spouseOtherIncome);
    // Each spouse: max − 0.5 × (combined / 2) ≈ max − 0.25 × combined
    return Math.max(0, max - GIS.reductionRate.value * 0.5 * combinedOther);
  }

  const max = GIS.maxAnnualSingle.value * cpi;
  // Single: full max reduces 50¢ per $1 of other income from the first dollar
  return Math.max(0, max - GIS.reductionRate.value * Math.max(0, p.otherIncome));
}
