import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import {
  SCHEMA_VERSION,
  serializeScenario,
  deserializeScenario,
  type SavedScenario,
} from "./scenarioStore";

describe("scenario persistence codec", () => {
  it("round-trips inputs + seed without re-implementing storage", () => {
    const inputs = sampleHousehold();
    inputs.spendingTargetToday = 88_500;
    inputs.persons[0].name = "TestA";
    const original: SavedScenario = {
      schemaVersion: SCHEMA_VERSION,
      id: "test-id",
      name: "Night sky plan",
      savedAt: "2026-07-20T12:00:00.000Z",
      seed: 99,
      inputs,
    };
    const raw = serializeScenario(original);
    const back = deserializeScenario(raw);
    expect(back).not.toBeNull();
    expect(back!.name).toBe("Night sky plan");
    expect(back!.seed).toBe(99);
    expect(back!.inputs.spendingTargetToday).toBe(88_500);
    expect(back!.inputs.persons[0].name).toBe("TestA");
    expect(back!.inputs.persons[1].birthYear).toBe(inputs.persons[1].birthYear);
  });

  it("rejects garbage", () => {
    expect(deserializeScenario("{}")).toBeNull();
    expect(deserializeScenario("not-json")).toBeNull();
  });
});
