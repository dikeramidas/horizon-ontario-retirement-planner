import { describe, it, expect } from "vitest";
import { mulberry32 } from "../mc";
import {
  annualDeathProbability,
  sampleCoupleDeaths,
  sampleDeathAge,
} from "./mortality";

describe("mortality sketch", () => {
  it("death probability rises with age", () => {
    const q60 = annualDeathProbability(60);
    const q80 = annualDeathProbability(80);
    const q100 = annualDeathProbability(100);
    expect(q80).toBeGreaterThan(q60);
    expect(q100).toBeGreaterThan(q80);
    expect(q60).toBeGreaterThan(0);
    expect(q100).toBeLessThanOrEqual(1);
  });

  it("sampleDeathAge is reproducible with a fixed RNG sequence", () => {
    const a = sampleDeathAge(70, mulberry32(42));
    const b = sampleDeathAge(70, mulberry32(42));
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(70);
    expect(a).toBeLessThanOrEqual(110);
  });

  it("younger current age has longer remaining life; older cohort dies at higher ages", () => {
    const n = 400;
    let sumYoung = 0;
    let sumOld = 0;
    for (let i = 0; i < n; i++) {
      sumYoung += sampleDeathAge(55, mulberry32(1000 + i));
      sumOld += sampleDeathAge(80, mulberry32(2000 + i));
    }
    const meanYoung = sumYoung / n;
    const meanOld = sumOld / n;
    // Conditioned on survival: mean death age is higher if already 80
    expect(meanOld).toBeGreaterThan(meanYoung);
    // But remaining expectancy is longer at 55
    expect(meanYoung - 55).toBeGreaterThan(meanOld - 80);
  });

  it("sampleCoupleDeaths maps first death into plan window when applicable", () => {
    const rng = mulberry32(7);
    let sawInPlan = false;
    for (let i = 0; i < 80; i++) {
      const d = sampleCoupleDeaths([1970, 1972], 2027, 2065, rng);
      expect(d.deathAge0).toBeGreaterThanOrEqual(2027 - 1970);
      if (d.hasInPlanDeath) {
        sawInPlan = true;
        expect(d.firstDeathYear).toBeGreaterThanOrEqual(2027);
        expect(d.firstDeathYear).toBeLessThanOrEqual(2065);
        expect(d.firstDeathPerson === 0 || d.firstDeathPerson === 1).toBe(true);
      }
    }
    expect(sawInPlan).toBe(true);
  });
});
