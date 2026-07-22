import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { analyzePlan } from "./analysis";
import { runMonteCarlo } from "../mc";
import type { ProgressEvent } from "./progress";

describe("progress hooks (main-thread)", () => {
  it("analyzePlan emits progress phases ending at done", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const events: ProgressEvent[] = [];
    analyzePlan(h, {
      quick: true,
      onProgress: (p) => events.push({ ...p }),
    });
    expect(events.length).toBeGreaterThan(2);
    expect(events.some((e) => e.phase === "strategy")).toBe(true);
    expect(events[events.length - 1].phase).toBe("done");
    expect(events[events.length - 1].fraction).toBe(1);
  });

  it("runMonteCarlo reports fraction toward 1", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const events: ProgressEvent[] = [];
    runMonteCarlo(
      { ...h, solverQuality: "fast" },
      {
        trials: 40,
        seed: 1,
        defaultVol: 0.11,
        onProgress: (p) => events.push({ ...p }),
      }
    );
    expect(events.length).toBeGreaterThan(2);
    expect(events.every((e) => e.phase === "montecarlo")).toBe(true);
    const last = events[events.length - 1];
    expect(last.fraction).toBeCloseTo(1, 5);
  });
});
