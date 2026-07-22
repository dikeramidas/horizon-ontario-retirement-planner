/**
 * D1 — Off-main-thread engine jobs (analyze, MC, spend-to-zero, scenario compare).
 * Progress posts back; cancel is worker.terminate() from the client.
 */
import { analyzePlan, type AnalysisOptions, type PlanAnalysis } from "../lib/analysis";
import { runMonteCarlo, type MonteCarloConfig, type MonteCarloResult } from "../mc";
import { findMaxSpendToZero, type SpendToZeroResult } from "../lib/spendToZero";
import { compareScenarios, type ScenarioCompareResult, type ScenarioSideInput } from "../lib/scenarioCompare";
import type { HouseholdInput } from "../simulate";
import type { ProgressEvent } from "../lib/progress";
import { prepareMonteCarloRun } from "../lib/analysis";

export type WorkerOp = "analyze" | "montecarlo" | "spendToZero" | "compare" | "prepareAndMc";

export interface WorkerRequest {
  id: string;
  op: WorkerOp;
  payload: unknown;
}

export interface WorkerProgressMsg {
  id: string;
  type: "progress";
  progress: ProgressEvent;
}

export interface WorkerResultMsg {
  id: string;
  type: "result";
  result: unknown;
}

export interface WorkerErrorMsg {
  id: string;
  type: "error";
  error: string;
}

export type WorkerOutbound = WorkerProgressMsg | WorkerResultMsg | WorkerErrorMsg;

function postProgress(id: string, progress: ProgressEvent) {
  const msg: WorkerProgressMsg = { id, type: "progress", progress };
  self.postMessage(msg);
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, op, payload } = ev.data;
  try {
    if (op === "analyze") {
      const p = payload as { input: HouseholdInput; opts?: AnalysisOptions };
      const result = analyzePlan(p.input, {
        ...(p.opts ?? {}),
        onProgress: (prog) => postProgress(id, prog),
      });
      self.postMessage({ id, type: "result", result } satisfies WorkerResultMsg);
      return;
    }

    if (op === "montecarlo") {
      const p = payload as {
        input: HouseholdInput;
        cfg: Omit<MonteCarloConfig, "onProgress">;
      };
      const result = runMonteCarlo(p.input, {
        ...p.cfg,
        onProgress: (prog) => postProgress(id, prog),
      });
      self.postMessage({ id, type: "result", result } satisfies WorkerResultMsg);
      return;
    }

    if (op === "prepareAndMc") {
      const p = payload as {
        input: HouseholdInput;
        state: {
          hasTune: boolean;
          stale: boolean;
          displayedCeiling?: number;
          displayedTfsaShare?: number;
        };
        mc: Omit<MonteCarloConfig, "onProgress">;
        analyzeOpts?: AnalysisOptions;
      };
      postProgress(id, { phase: "prepare", fraction: 0.05, detail: "Preparing strategy for stress test…" });
      const prep = prepareMonteCarloRun(p.input, p.state, {
        ...(p.analyzeOpts ?? { quick: true }),
        onProgress: (prog) =>
          postProgress(id, {
            ...prog,
            fraction: prog.fraction != null ? prog.fraction * 0.35 : undefined,
            detail: prog.detail ?? "Analyzing…",
          }),
      });
      postProgress(id, { phase: "montecarlo", fraction: 0.4, detail: "Running market paths…" });
      const mc = runMonteCarlo(prep.household, {
        ...p.mc,
        onProgress: (prog) =>
          postProgress(id, {
            ...prog,
            fraction: 0.4 + (prog.fraction ?? 0) * 0.6,
          }),
      });
      const result = {
        analysis: prep.analysis,
        ceiling: prep.ceiling,
        tfsaFirstShare: prep.tfsaFirstShare,
        household: prep.household,
        mc,
      };
      self.postMessage({ id, type: "result", result } satisfies WorkerResultMsg);
      return;
    }

    if (op === "spendToZero") {
      const p = payload as {
        input: HouseholdInput;
        opts?: Parameters<typeof findMaxSpendToZero>[1];
      };
      const result: SpendToZeroResult = findMaxSpendToZero(p.input, {
        ...(p.opts ?? {}),
        onProgress: (prog) => postProgress(id, prog),
      });
      self.postMessage({ id, type: "result", result } satisfies WorkerResultMsg);
      return;
    }

    if (op === "compare") {
      const p = payload as {
        left: ScenarioSideInput;
        right: ScenarioSideInput;
        opts?: AnalysisOptions;
      };
      postProgress(id, { phase: "compare-left", fraction: 0.1, detail: `Analyzing ${p.left.label}…` });
      // compareScenarios runs both; report coarse progress around the call
      const result: ScenarioCompareResult = compareScenarios(p.left, p.right, {
        ...(p.opts ?? { quick: true }),
        onProgress: (prog) =>
          postProgress(id, {
            ...prog,
            detail: prog.detail ?? "Comparing scenarios…",
          }),
      });
      // Note: compareScenarios only gets progress on second analyze if we change it —
      // for now wrap with two analyzePlan calls with progress in scenarioCompare later if needed.
      postProgress(id, { phase: "done", fraction: 1, detail: "Compare ready" });
      self.postMessage({ id, type: "result", result } satisfies WorkerResultMsg);
      return;
    }

    throw new Error(`Unknown worker op: ${op}`);
  } catch (e) {
    const msg: WorkerErrorMsg = {
      id,
      type: "error",
      error: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(msg);
  }
};

export type { PlanAnalysis, MonteCarloResult, SpendToZeroResult, ScenarioCompareResult };
