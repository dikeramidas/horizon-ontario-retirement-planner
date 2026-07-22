/**
 * Ontario Estate Administration Tax (probate) sketch.
 * Source shape: $5 per $1,000 on the first $50,000 + $15 per $1,000 above
 * (common Ontario EAT schedule). Continuous approximation (no per-$1,000 rounding).
 *
 * This is an *upper-bound style* sketch: joint assets with right of survivorship,
 * beneficiary designations on registered plans, and multiple wills are not modelled.
 */
import { ONTARIO_EAT } from "../constants-2026";

export function ontarioEstateAdminTax(probateableValue: number): number {
  if (!Number.isFinite(probateableValue) || probateableValue <= 0) return 0;
  const thr = ONTARIO_EAT.threshold.value;
  const first = Math.min(probateableValue, thr);
  const rest = Math.max(0, probateableValue - thr);
  return first * ONTARIO_EAT.rateFirstBand.value + rest * ONTARIO_EAT.rateAboveThreshold.value;
}
