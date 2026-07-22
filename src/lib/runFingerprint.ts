/**
 * C7 — Reproducibility pack: snapshot of inputs + run knobs for support/debug.
 */
import type { HouseholdInput } from "../simulate";
import { resolveTfsaLevel } from "./tfsaPolicy";
import { POLICY_BASELINE } from "../constants-2026";

export const FINGERPRINT_VERSION = 1;

export interface RunFingerprint {
  v: number;
  app: string;
  policyTaxYear: number;
  policyRetrievedOn: string;
  createdAt: string;
  seed: number;
  mcTrials: number;
  defaultVol: number;
  inputs: HouseholdInput;
}

export function buildRunFingerprint(opts: {
  inputs: HouseholdInput;
  seed: number;
  mcTrials: number;
  defaultVol: number;
}): RunFingerprint {
  const inputs = structuredClone(opts.inputs);
  // Normalize TFSA level for clarity
  if (inputs.strategy) {
    inputs.strategy = {
      ...inputs.strategy,
      tfsaLevel: resolveTfsaLevel(inputs.strategy.tfsaLevel),
    };
  }
  return {
    v: FINGERPRINT_VERSION,
    app: "horizon",
    policyTaxYear: POLICY_BASELINE.taxYear,
    policyRetrievedOn: POLICY_BASELINE.retrievedOn,
    createdAt: new Date().toISOString(),
    seed: opts.seed,
    mcTrials: opts.mcTrials,
    defaultVol: opts.defaultVol,
    inputs,
  };
}

export function serializeFingerprint(fp: RunFingerprint): string {
  return JSON.stringify(fp, null, 2);
}

export function parseFingerprint(raw: string): RunFingerprint | null {
  try {
    const p = JSON.parse(raw) as RunFingerprint;
    if (!p || p.v !== FINGERPRINT_VERSION || p.app !== "horizon" || !p.inputs?.persons) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/** Simple stable hash for display (not cryptographic). */
export function fingerprintDigest(fp: RunFingerprint): string {
  const s = JSON.stringify({
    seed: fp.seed,
    mcTrials: fp.mcTrials,
    defaultVol: fp.defaultVol,
    spend: fp.inputs.spendingTargetToday,
    c: fp.inputs.strategy?.topUpCeilingToday,
    tfsa: fp.inputs.strategy?.tfsaLevel,
    a: fp.inputs.persons[0].birthYear,
    b: fp.inputs.persons[1].birthYear,
  });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
