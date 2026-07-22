import { describe, it, expect, beforeEach } from "vitest";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  initialPlanState,
  DRAFT_SCHEMA,
} from "./draftStore";
import { sampleHousehold } from "./sampleHousehold";

const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  // Minimal localStorage mock for node tests
  const ls = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  clearDraft();
});

describe("draftStore", () => {
  it("round-trips inputs and MC settings through localStorage", () => {
    const inputs = sampleHousehold();
    inputs.spendingTargetToday = 77_000;
    inputs.persons[0].name = "Pat";
    saveDraft({
      inputs,
      seed: 99,
      mcTrials: 250,
      defaultVol: 0.12,
      scenarioName: "Draft A",
    });
    const back = loadDraft();
    expect(back).not.toBeNull();
    expect(back!.schemaVersion).toBe(DRAFT_SCHEMA);
    expect(back!.inputs.spendingTargetToday).toBe(77_000);
    expect(back!.inputs.persons[0].name).toBe("Pat");
    expect(back!.seed).toBe(99);
    expect(back!.mcTrials).toBe(250);
    expect(back!.defaultVol).toBe(0.12);
    expect(back!.scenarioName).toBe("Draft A");
  });

  it("initialPlanState restores draft when present", () => {
    const inputs = sampleHousehold();
    inputs.spendingTargetToday = 88_000;
    saveDraft({
      inputs,
      seed: 7,
      mcTrials: 100,
      defaultVol: 0.1,
      scenarioName: "Saved",
    });
    const init = initialPlanState();
    expect(init.restored).toBe(true);
    expect(init.inputs.spendingTargetToday).toBe(88_000);
    expect(init.seed).toBe(7);
  });

  it("initialPlanState falls back to sample when empty", () => {
    clearDraft();
    const init = initialPlanState();
    expect(init.restored).toBe(false);
    expect(init.inputs.persons[0].name).toBeTruthy();
  });
});
