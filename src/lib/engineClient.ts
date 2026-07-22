/**
 * D1/D4 — Main-thread client for the engine worker (progress + cancel).
 */
import type { HouseholdInput } from "../simulate";
import type { AnalysisOptions, PlanAnalysis } from "./analysis";
import type { MonteCarloConfig, MonteCarloResult } from "../mc";
import type { SpendToZeroResult } from "./spendToZero";
import type { ScenarioCompareResult, ScenarioSideInput } from "./scenarioCompare";
import type { ProgressEvent } from "./progress";
import type { WorkerOp, WorkerOutbound, WorkerRequest } from "../workers/engineWorker";

export type EngineJobResultMap = {
  analyze: PlanAnalysis;
  montecarlo: MonteCarloResult;
  spendToZero: SpendToZeroResult;
  compare: ScenarioCompareResult;
  prepareAndMc: {
    analysis: PlanAnalysis | null;
    ceiling: number;
    tfsaFirstShare: number;
    household: HouseholdInput;
    mc: MonteCarloResult;
  };
};

let jobSeq = 0;

function createWorker(): Worker {
  return new Worker(new URL("../workers/engineWorker.ts", import.meta.url), {
    type: "module",
  });
}

export class EngineJobCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "EngineJobCancelled";
  }
}

/**
 * Run an engine op off the main thread. Pass AbortSignal to cancel (terminates worker).
 */
export function runEngineJob<K extends WorkerOp>(
  op: K,
  payload: unknown,
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: ProgressEvent) => void;
  } = {}
): Promise<EngineJobResultMap[K]> {
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("Web Workers are not available in this environment"));
  }

  return new Promise((resolve, reject) => {
    const id = `job-${++jobSeq}`;
    let worker: Worker;
    try {
      worker = createWorker();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const cleanup = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new EngineJobCancelled());
    };

    if (opts.signal?.aborted) {
      cleanup();
      reject(new EngineJobCancelled());
      return;
    }
    opts.signal?.addEventListener("abort", onAbort);

    worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
      const msg = ev.data;
      if (!msg || msg.id !== id) return;
      if (msg.type === "progress") {
        opts.onProgress?.(msg.progress);
        return;
      }
      if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.error));
        return;
      }
      if (msg.type === "result") {
        cleanup();
        resolve(msg.result as EngineJobResultMap[K]);
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(err.error ?? new Error(err.message || "Worker error"));
    };

    const req: WorkerRequest = { id, op, payload };
    worker.postMessage(req);
  });
}

/** Fallback: run analyze on main thread (tests / worker unavailable). */
export async function analyzePlanAsync(
  input: HouseholdInput,
  opts: AnalysisOptions & { signal?: AbortSignal; onProgress?: (p: ProgressEvent) => void } = {}
): Promise<PlanAnalysis> {
  const { signal, onProgress, ...analyzeOpts } = opts;
  try {
    return await runEngineJob("analyze", { input, opts: analyzeOpts }, { signal, onProgress });
  } catch (e) {
    if (e instanceof EngineJobCancelled) throw e;
    // Node/tests without Worker module URL support
    const { analyzePlan } = await import("./analysis");
    return analyzePlan(input, { ...analyzeOpts, onProgress });
  }
}

export async function runMonteCarloAsync(
  input: HouseholdInput,
  cfg: Omit<MonteCarloConfig, "onProgress">,
  opts: { signal?: AbortSignal; onProgress?: (p: ProgressEvent) => void } = {}
): Promise<MonteCarloResult> {
  try {
    return await runEngineJob("montecarlo", { input, cfg }, opts);
  } catch (e) {
    if (e instanceof EngineJobCancelled) throw e;
    const { runMonteCarlo } = await import("../mc");
    return runMonteCarlo(input, {
      ...cfg,
      onProgress: opts.onProgress,
    });
  }
}

export async function findMaxSpendToZeroAsync(
  input: HouseholdInput,
  spendOpts: Parameters<typeof import("./spendToZero").findMaxSpendToZero>[1] = {},
  opts: { signal?: AbortSignal; onProgress?: (p: ProgressEvent) => void } = {}
): Promise<SpendToZeroResult> {
  try {
    return await runEngineJob(
      "spendToZero",
      { input, opts: { ...spendOpts, onProgress: undefined } },
      opts
    );
  } catch (e) {
    if (e instanceof EngineJobCancelled) throw e;
    const { findMaxSpendToZero } = await import("./spendToZero");
    return findMaxSpendToZero(input, { ...spendOpts, onProgress: opts.onProgress });
  }
}

export async function compareScenariosAsync(
  left: ScenarioSideInput,
  right: ScenarioSideInput,
  analyzeOpts: AnalysisOptions = { quick: true },
  opts: { signal?: AbortSignal; onProgress?: (p: ProgressEvent) => void } = {}
): Promise<ScenarioCompareResult> {
  try {
    return await runEngineJob(
      "compare",
      { left, right, opts: analyzeOpts },
      opts
    );
  } catch (e) {
    if (e instanceof EngineJobCancelled) throw e;
    const { compareScenarios } = await import("./scenarioCompare");
    return compareScenarios(left, right, { ...analyzeOpts, onProgress: opts.onProgress });
  }
}

export async function prepareAndRunMonteCarloAsync(
  input: HouseholdInput,
  state: {
    hasTune: boolean;
    stale: boolean;
    displayedCeiling?: number;
    displayedTfsaShare?: number;
  },
  mc: Omit<MonteCarloConfig, "onProgress">,
  opts: { signal?: AbortSignal; onProgress?: (p: ProgressEvent) => void } = {}
): Promise<EngineJobResultMap["prepareAndMc"]> {
  try {
    return await runEngineJob(
      "prepareAndMc",
      { input, state, mc, analyzeOpts: { quick: true } },
      opts
    );
  } catch (e) {
    if (e instanceof EngineJobCancelled) throw e;
    const { prepareMonteCarloRun } = await import("./analysis");
    const { runMonteCarlo } = await import("../mc");
    opts.onProgress?.({ phase: "prepare", fraction: 0.1, detail: "Preparing strategy…" });
    const prep = prepareMonteCarloRun(input, state, {
      quick: true,
      onProgress: opts.onProgress,
    });
    const mcRes = runMonteCarlo(prep.household, {
      ...mc,
      onProgress: opts.onProgress,
    });
    return {
      analysis: prep.analysis,
      ceiling: prep.ceiling,
      tfsaFirstShare: prep.tfsaFirstShare,
      household: prep.household,
      mc: mcRes,
    };
  }
}
