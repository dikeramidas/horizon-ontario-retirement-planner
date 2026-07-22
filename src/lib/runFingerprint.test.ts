import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import {
  buildRunFingerprint,
  fingerprintDigest,
  parseFingerprint,
  serializeFingerprint,
} from "./runFingerprint";

describe("runFingerprint", () => {
  it("round-trips JSON and stable digest", () => {
    const h = sampleHousehold();
    const fp = buildRunFingerprint({
      inputs: h,
      seed: 42,
      mcTrials: 400,
      defaultVol: 0.11,
    });
    const raw = serializeFingerprint(fp);
    const back = parseFingerprint(raw);
    expect(back).not.toBeNull();
    expect(back!.seed).toBe(42);
    expect(back!.inputs.spendingTargetToday).toBe(h.spendingTargetToday);
    expect(fingerprintDigest(back!)).toBe(fingerprintDigest(fp));
    expect(parseFingerprint("not-json")).toBeNull();
  });
});
