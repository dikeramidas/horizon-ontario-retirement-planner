/**
 * Lightweight mortality sketch for stochastic longevity trials.
 *
 * Not an official Canadian life table. Uses a Gompertz-style annual force of
 * mortality so residual lifetime lengthens sensibly with younger current ages.
 * Spouses are sampled independently (no shared frailty).
 */

/** Gompertz force μ(x) = A·e^{B·x}; q_x = 1 − e^{−μ(x)}. */
export const MORTALITY_DEFAULTS = {
  A: 3.5e-5,
  B: 0.092,
  maxAge: 110,
  /** Floor for very young ages in our planning domain. */
  minAge: 40,
} as const;

/** Annual death probability at integer attained age (year-end convention). */
export function annualDeathProbability(
  age: number,
  params: { A?: number; B?: number } = {}
): number {
  const A = params.A ?? MORTALITY_DEFAULTS.A;
  const B = params.B ?? MORTALITY_DEFAULTS.B;
  if (!Number.isFinite(age)) return 1;
  if (age >= MORTALITY_DEFAULTS.maxAge) return 1;
  if (age < MORTALITY_DEFAULTS.minAge) {
    const muYoung = A * Math.exp(B * MORTALITY_DEFAULTS.minAge);
    return Math.min(0.5, 1 - Math.exp(-muYoung * 0.35));
  }
  const mu = A * Math.exp(B * age);
  return Math.min(0.75, 1 - Math.exp(-mu));
}

/**
 * Sample attained age at death given current attained age (integer).
 * Uses sequential annual Bernoulli trials with q_x.
 */
export function sampleDeathAge(
  currentAge: number,
  rng: () => number,
  opts: { maxAge?: number; A?: number; B?: number } = {}
): number {
  const maxAge = opts.maxAge ?? MORTALITY_DEFAULTS.maxAge;
  let age = Math.max(0, Math.floor(currentAge));
  // Allow death in the current year of age
  while (age < maxAge) {
    if (rng() < annualDeathProbability(age, opts)) return age;
    age += 1;
  }
  return maxAge;
}

export interface SampledDeaths {
  deathAge0: number;
  deathAge1: number;
  deathYear0: number;
  deathYear1: number;
  /** Who dies first within the plan (undefined if neither dies in-window). */
  firstDeathPerson?: 0 | 1;
  firstDeathYear?: number;
  firstDeathAge?: number;
  /** True when at least one death year falls inside [startYear, planEndYear]. */
  hasInPlanDeath: boolean;
}

/**
 * Sample independent death ages and map to first-death inputs for simulate().
 * Death year = birthYear + deathAge (engine age convention).
 */
export function sampleCoupleDeaths(
  birthYears: [number, number],
  startYear: number,
  planEndYear: number,
  rng: () => number,
  opts?: { A?: number; B?: number; maxAge?: number }
): SampledDeaths {
  const age0 = startYear - birthYears[0];
  const age1 = startYear - birthYears[1];
  const deathAge0 = sampleDeathAge(age0, rng, opts);
  const deathAge1 = sampleDeathAge(age1, rng, opts);
  const deathYear0 = birthYears[0] + deathAge0;
  const deathYear1 = birthYears[1] + deathAge1;

  const in0 = deathYear0 >= startYear && deathYear0 <= planEndYear;
  const in1 = deathYear1 >= startYear && deathYear1 <= planEndYear;

  let firstDeathPerson: 0 | 1 | undefined;
  let firstDeathYear: number | undefined;
  let firstDeathAge: number | undefined;

  if (in0 && in1) {
    if (deathYear0 < deathYear1) {
      firstDeathPerson = 0;
      firstDeathYear = deathYear0;
      firstDeathAge = deathAge0;
    } else if (deathYear1 < deathYear0) {
      firstDeathPerson = 1;
      firstDeathYear = deathYear1;
      firstDeathAge = deathAge1;
    } else {
      // Same calendar year: coin flip for who is "first" in the engine
      firstDeathPerson = rng() < 0.5 ? 0 : 1;
      firstDeathYear = deathYear0;
      firstDeathAge = firstDeathPerson === 0 ? deathAge0 : deathAge1;
    }
  } else if (in0) {
    firstDeathPerson = 0;
    firstDeathYear = deathYear0;
    firstDeathAge = deathAge0;
  } else if (in1) {
    firstDeathPerson = 1;
    firstDeathYear = deathYear1;
    firstDeathAge = deathAge1;
  }

  return {
    deathAge0,
    deathAge1,
    deathYear0,
    deathYear1,
    firstDeathPerson,
    firstDeathYear,
    firstDeathAge,
    hasInPlanDeath: firstDeathYear != null,
  };
}
