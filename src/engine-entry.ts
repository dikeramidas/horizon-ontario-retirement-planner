/** Artifact bundle entry — everything the UI needs from the engine. */
export { simulate } from "./simulate";
export type { HouseholdInput, SimulationResult, PersonInput, SimPath } from "./simulate";
export { runMonteCarlo, generateTrialPath, tuneStrategy, mulberry32, deriveSeed } from "./mc";
export type { MonteCarloConfig, MonteCarloResult, TuneResult } from "./mc";
export { ECON_DEFAULTS, VALIDATION_ANCHORS } from "./constants-2026";
export { POLICY_2026 } from "./policy";
