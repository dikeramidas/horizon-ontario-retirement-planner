import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type HouseholdInput,
  type PersonInput,
  type SimulationResult,
  type MonteCarloResult,
  type TuneResult,
} from "./engine-entry";
import { sampleHousehold } from "./lib/sampleHousehold";
import { money, pct } from "./lib/format";
import {
  listScenarios,
  saveScenario,
  loadScenario,
  deleteScenario,
  type SavedScenario,
} from "./lib/scenarioStore";
import { analyzePlan, type PlanAnalysis } from "./lib/analysis";
import { validateHousehold } from "./lib/validate";
import {
  analyzePlanAsync,
  prepareAndRunMonteCarloAsync,
  EngineJobCancelled,
} from "./lib/engineClient";
import type { ProgressEvent } from "./lib/progress";
import {
  readSavingsMode,
  readSavingsValue,
  setPersonSavings,
  type SavingsAccount,
} from "./lib/savings";
import { FanChart, WithdrawalStackChart } from "./components/Charts";
import { CashflowTable } from "./components/CashflowTable";
import { DrawdownDetail } from "./components/DrawdownDetail";
import { DrawdownFullPage } from "./pages/DrawdownFullPage";
import { TaxStrategyExplain } from "./components/TaxStrategyExplain";
import { MetricsGuide } from "./components/MetricsGuide";
import { ShortfallPanel } from "./components/ShortfallPanel";
import { SpendToZeroPanel } from "./components/SpendToZeroPanel";
import { ScenarioComparePanel } from "./components/ScenarioCompare";
import { BenefitStartGridPanel } from "./components/BenefitStartGrid";
import { ExportPlanBar } from "./components/ExportPlanBar";
import { CollapsibleSection } from "./components/CollapsibleSection";
import { TfsaRoomPanel } from "./components/TfsaRoomPanel";
import { RunFingerprintPanel } from "./components/RunFingerprintPanel";
import { AdvancedPlanOptions } from "./components/AdvancedPlanOptions";
import { SensitivityPanel } from "./components/SensitivityPanel";
import { UnitBadge } from "./components/UnitBadge";
import { GlossaryTip } from "./components/GlossaryTip";
import { useHashRoute, parseDrawdownRoute } from "./lib/hashRoute";
import { saveLastPlan } from "./lib/lastPlanStore";
import { initialPlanState, saveDraft } from "./lib/draftStore";
import {
  typicalFirstShortfallYear,
  failureRate,
  countFailingTrials,
} from "./lib/mcSummary";
import { estateTaxOf } from "./lib/estateTax";
import { POLICY_BASELINE } from "./constants-2026";
import { resolveTfsaLevel, TFSA_LEVEL_OPTIONS, type TfsaLevel } from "./lib/tfsaPolicy";

type Tab = "household" | "alex" | "jordan" | "assumptions" | "strategy" | "scenarios";
type RunKind = "idle" | "analyze" | "mc";

function cloneInput(h: HouseholdInput): HouseholdInput {
  return structuredClone(h);
}

function Field({
  label,
  hint,
  children,
  full,
  layout = "stack",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  full?: boolean;
  /** stack = label above input; row = label left, control right (aligned column) */
  layout?: "stack" | "row";
}) {
  return (
    <label className={`field field-${layout}${full ? " full" : ""}`}>
      <span className="field-label-row">
        <span className="field-label-text">{label}</span>
        {hint ? <span className="field-hint" title={hint}>?</span> : null}
      </span>
      <span className="field-control">{children}</span>
    </label>
  );
}

function numInput(
  value: number | undefined,
  onChange: (n: number) => void,
  step = 1
) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function App() {
  const route = useHashRoute();
  const drawdownMode = parseDrawdownRoute(route);

  const [boot] = useState(() => initialPlanState());
  const [input, setInput] = useState<HouseholdInput>(() => boot.inputs);
  const [tab, setTab] = useState<Tab>("household");
  const [seed, setSeed] = useState(() => boot.seed);
  const [mcTrials, setMcTrials] = useState(() => boot.mcTrials);
  const [defaultVol, setDefaultVol] = useState(() => boot.defaultVol);
  const [inflationKind, setInflationKind] = useState<"fixed" | "ar1">("fixed");
  const [running, setRunning] = useState<RunKind>("idle");
  const [error, setError] = useState<string | null>(null);
  const [det, setDet] = useState<SimulationResult | null>(null);
  const [tune, setTune] = useState<TuneResult | null>(null);
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [scenarioName, setScenarioName] = useState(() => boot.scenarioName);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [autoDone, setAutoDone] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [comfortableTables, setComfortableTables] = useState(() => {
    try {
      return localStorage.getItem("horizon:comfortable-tables") === "1";
    } catch {
      return false;
    }
  });
  const inputRef = useRef(input);
  inputRef.current = input;
  const abortRef = useRef<AbortController | null>(null);
  const tuneRef = useRef(tune);
  tuneRef.current = tune;
  const staleRef = useRef(stale);
  staleRef.current = stale;

  // Persist working form across browser refresh (localStorage)
  useEffect(() => {
    saveDraft({
      inputs: input,
      seed,
      mcTrials,
      defaultVol,
      scenarioName,
    });
  }, [input, seed, mcTrials, defaultVol, scenarioName]);

  const personNames = useMemo(
    (): [string, string] => [
      input.persons[0].name || "Spouse A",
      input.persons[1].name || "Spouse B",
    ],
    [input.persons]
  );

  const validation = useMemo(() => validateHousehold(input), [input]);

  const refreshScenarios = useCallback(() => {
    setScenarios(listScenarios());
  }, []);

  useEffect(() => {
    refreshScenarios();
  }, [refreshScenarios]);

  const markDirty = () => {
    setStale(true);
    setMc(null);
  };

  const setPerson = (idx: 0 | 1, patch: Partial<PersonInput>) => {
    markDirty();
    setInput((prev) => {
      const persons = [...prev.persons] as [PersonInput, PersonInput];
      persons[idx] = { ...persons[idx], ...patch };
      return { ...prev, persons };
    });
  };

  const setBalances = (idx: 0 | 1, key: string, value: number) => {
    markDirty();
    setInput((prev) => {
      const persons = [...prev.persons] as [PersonInput, PersonInput];
      const p = persons[idx];
      const balances = { ...(p.balances ?? {}) };
      if (key === "unregBal" || key === "unregAcb") {
        const u = {
          balance: balances.unregistered?.balance ?? 0,
          acb: balances.unregistered?.acb ?? 0,
        };
        if (key === "unregBal") u.balance = value;
        else u.acb = value;
        balances.unregistered = u;
      } else {
        (balances as Record<string, number>)[key] = value;
      }
      persons[idx] = { ...p, balances };
      return { ...prev, persons };
    });
  };

  const setReturn = (idx: 0 | 1, key: string, value: number) => {
    markDirty();
    setInput((prev) => {
      const persons = [...prev.persons] as [PersonInput, PersonInput];
      const p = persons[idx];
      persons[idx] = { ...p, returns: { ...(p.returns ?? {}), [key]: value } };
      return { ...prev, persons };
    });
  };

  const setSavings = (
    idx: 0 | 1,
    account: SavingsAccount,
    mode: "none" | "fixed" | "pctOfSalary",
    value: number
  ) => {
    markDirty();
    setInput((prev) => {
      const persons = [...prev.persons] as [PersonInput, PersonInput];
      persons[idx] = setPersonSavings(persons[idx], account, mode, value);
      return { ...prev, persons };
    });
  };

  const applyAnalysisResult = useCallback((h: HouseholdInput, a: PlanAnalysis) => {
    const next = {
      ...h,
      strategy: {
        ...h.strategy,
        topUpCeilingToday: a.bestCeilingToday,
        ceilingBands: a.bestCeilingBands ?? h.strategy?.ceilingBands,
        oasSoftCap: a.oasSoftCap,
        personCeilingsToday: a.personCeilingsToday ?? h.strategy?.personCeilingsToday,
        topUpPriority: h.strategy?.topUpPriority ?? "higherReg",
        tfsaAwareMeltdown: h.strategy?.tfsaAwareMeltdown !== false,
        tfsaLevel: h.strategy?.tfsaLevel ?? "l4",
        tfsaReserveYears: h.strategy?.tfsaReserveYears ?? 2,
        tfsaFirstShare: a.tfsaTune?.bestShare ?? h.strategy?.tfsaFirstShare ?? 0,
      },
    };
    const names: [string, string] = [
      next.persons[0].name || "Spouse A",
      next.persons[1].name || "Spouse B",
    ];
    setTune(a.tune);
    setDet(a.primary);
    setInput(next);
    inputRef.current = next;
    setStale(false);
    setMc(null);
    saveLastPlan(next, names);
    return a;
  }, []);

  const cancelRunning = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /** Primary path: strategy search + deterministic results + naive baseline (worker). */
  const onAnalyze = (quick = false) => {
    void (async () => {
      cancelRunning();
      const ac = new AbortController();
      abortRef.current = ac;
      setError(null);
      setRunning("analyze");
      setProgress({ phase: "start", fraction: 0, detail: "Starting full plan…" });
      const t0 = performance.now();
      try {
        const a = await analyzePlanAsync(inputRef.current, {
          quick,
          signal: ac.signal,
          onProgress: setProgress,
        });
        applyAnalysisResult(inputRef.current, a);
        setElapsed(performance.now() - t0);
      } catch (e) {
        if (e instanceof EngineJobCancelled) {
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setRunning("idle");
        setProgress(null);
        abortRef.current = null;
      }
    })();
  };

  const onMonteCarlo = () => {
    void (async () => {
      if (!validation.ok) {
        setError(validation.errors.map((e) => e.message).join(" "));
        return;
      }
      cancelRunning();
      const ac = new AbortController();
      abortRef.current = ac;
      setError(null);
      setRunning("mc");
      setProgress({ phase: "start", fraction: 0, detail: "Starting stress test…" });
      const t0 = performance.now();
      try {
        const h = inputRef.current;
        const t = tuneRef.current;
        const st = staleRef.current;
        const prep = await prepareAndRunMonteCarloAsync(
          h,
          {
            hasTune: !!t && !st,
            stale: st,
            displayedCeiling: t && !st ? t.bestCeilingToday : undefined,
            displayedTfsaShare:
              t && !st ? inputRef.current.strategy?.tfsaFirstShare : undefined,
          },
          {
            trials: mcTrials,
            seed,
            defaultVol,
            inflation:
              inflationKind === "ar1"
                ? { kind: "ar1" as const }
                : { kind: "fixed" as const },
          },
          { signal: ac.signal, onProgress: setProgress }
        );
        if (prep.analysis) {
          setTune(prep.analysis.tune);
          setDet(prep.analysis.primary);
          const nextStrat = {
            ...h.strategy,
            topUpCeilingToday: prep.ceiling,
            ceilingBands: prep.analysis.bestCeilingBands ?? h.strategy?.ceilingBands,
            oasSoftCap: prep.analysis.oasSoftCap,
            tfsaLevel: h.strategy?.tfsaLevel ?? "l4",
            tfsaReserveYears: h.strategy?.tfsaReserveYears ?? 2,
            tfsaFirstShare: prep.tfsaFirstShare,
          };
          const next = { ...h, strategy: nextStrat };
          setInput(next);
          inputRef.current = next;
        }
        setMc(prep.mc);
        setStale(false);
        setElapsed(performance.now() - t0);
      } catch (e) {
        if (e instanceof EngineJobCancelled) {
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setRunning("idle");
        setProgress(null);
        abortRef.current = null;
      }
    })();
  };

  // First paint: auto-analyze current form (restored draft or sample)
  useEffect(() => {
    if (autoDone) return;
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      setRunning("analyze");
      setError(null);
      setProgress({ phase: "start", fraction: 0, detail: "Loading sample plan…" });
      await new Promise((r) => setTimeout(r, 40));
      const t0 = performance.now();
      try {
        const a = await analyzePlanAsync(inputRef.current, {
          quick: true,
          signal: ac.signal,
          onProgress: setProgress,
        });
        if (!ac.signal.aborted) {
          applyAnalysisResult(inputRef.current, a);
          setElapsed(performance.now() - t0);
        }
      } catch (e) {
        if (!(e instanceof EngineJobCancelled) && !ac.signal.aborted) {
          // Fallback: main-thread analyze if worker fails at boot
          try {
            const a = analyzePlan(inputRef.current, { quick: true });
            applyAnalysisResult(inputRef.current, a);
            setElapsed(performance.now() - t0);
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : String(e2));
          }
        }
      } finally {
        if (!ac.signal.aborted) {
          setRunning("idle");
          setProgress(null);
          setAutoDone(true);
        }
      }
    })();
    return () => {
      ac.abort();
    };
  }, [autoDone, applyAnalysisResult]);

  const onSave = () => {
    saveScenario(scenarioName, cloneInput(input), seed);
    refreshScenarios();
  };

  const onLoad = (id: string) => {
    const s = loadScenario(id);
    if (!s) return;
    const next = cloneInput(s.inputs);
    setInput(next);
    inputRef.current = next;
    setSeed(s.seed);
    setScenarioName(s.name);
    setMc(null);
    // recompute immediately so results never look "broken empty"
    void (async () => {
      cancelRunning();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning("analyze");
      setProgress({ phase: "start", fraction: 0, detail: "Loading scenario…" });
      try {
        const a = await analyzePlanAsync(next, {
          quick: true,
          signal: ac.signal,
          onProgress: setProgress,
        });
        applyAnalysisResult(next, a);
      } catch (e) {
        if (!(e instanceof EngineJobCancelled)) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setRunning("idle");
        setProgress(null);
        abortRef.current = null;
      }
    })();
  };

  const onResetSample = () => {
    const h = sampleHousehold();
    setInput(h);
    inputRef.current = h;
    setSeed(42);
    setScenarioName("Our plan");
    void (async () => {
      cancelRunning();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning("analyze");
      setProgress({ phase: "start", fraction: 0, detail: "Loading sample…" });
      try {
        const a = await analyzePlanAsync(h, {
          quick: true,
          signal: ac.signal,
          onProgress: setProgress,
        });
        applyAnalysisResult(h, a);
      } catch (e) {
        if (!(e instanceof EngineJobCancelled)) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setRunning("idle");
        setProgress(null);
        abortRef.current = null;
      }
    })();
  };

  const displayResult = det ?? tune?.tuned ?? null;
  const fundedOk = displayResult ? !displayResult.failedAnyYear : null;

  const busyLabel = useMemo(() => {
    if (running === "analyze") {
      return progress?.detail ?? "Running full plan (path + tax strategy)…";
    }
    if (running === "mc") {
      return progress?.detail ?? `Market stress test · ${mcTrials} paths…`;
    }
    return null;
  }, [running, mcTrials, progress]);

  // Full-page drawdown tables (no nested scroll) — hash routes
  // Must stay below every hook call (Rules of Hooks).
  if (drawdownMode) {
    return (
      <DrawdownFullPage
        mode={drawdownMode}
        result={displayResult}
        personNames={personNames}
        onResult={(r, names, nextInput) => {
          setDet(r);
          setInput(nextInput);
          inputRef.current = nextInput;
          saveLastPlan(nextInput, names);
        }}
      />
    );
  }

  const savingsFields = (idx: 0 | 1, account: SavingsAccount, label: string) => {
    const p = input.persons[idx];
    const spec = p.savings?.[account];
    const mode = readSavingsMode(spec);
    const raw = readSavingsValue(spec);
    const display = mode === "pctOfSalary" ? raw * 100 : raw;
    return (
      <>
        <Field label={`${label} mode`}>
          <select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as "none" | "fixed" | "pctOfSalary";
              const v = m === "pctOfSalary" ? 0.1 : m === "fixed" ? 5000 : 0;
              setSavings(idx, account, m, v);
            }}
          >
            <option value="none">None</option>
            <option value="fixed">Fixed $ / year</option>
            <option value="pctOfSalary">% of salary</option>
          </select>
        </Field>
        {mode !== "none" && (
          <Field
            label={mode === "pctOfSalary" ? `${label} %` : `${label} $ / yr`}
            hint={mode === "pctOfSalary" ? "Enter 12 for 12% of salary" : "Today's dollars; grows with CPI if fixed"}
          >
            {numInput(
              display,
              (n) => setSavings(idx, account, mode, mode === "pctOfSalary" ? n / 100 : n),
              mode === "pctOfSalary" ? 0.5 : 500
            )}
          </Field>
        )}
      </>
    );
  };

  const personForm = (idx: 0 | 1) => {
    const p = input.persons[idx];
    const bal = p.balances ?? {};
    return (
      <>
        <p className="hint">
          Who they are, what they earn, what they already have, and how they save while working.
        </p>
        <div className="subhead">About them</div>
        <div className="field-grid">
          <Field label="Name">
            <input value={p.name} onChange={(e) => setPerson(idx, { name: e.target.value })} />
          </Field>
          <Field label="Birth year" hint="Used for ages, RRIF, OAS boost at 75">
            {numInput(p.birthYear, (n) => setPerson(idx, { birthYear: n }))}
          </Field>
          <Field label="Retire at age" hint="Salary stops; locked pensions can convert to LIF">
            {numInput(p.retirementAge, (n) => setPerson(idx, { retirementAge: n }))}
          </Field>
          <Field label="Salary today ($/yr)">
            {numInput(p.salaryToday ?? 0, (n) => setPerson(idx, { salaryToday: n }), 1000)}
          </Field>
          <Field label="Salary growth above inflation" hint="e.g. 0.01 = 1% real raise">
            {numInput(p.salaryRealGrowth ?? 0, (n) => setPerson(idx, { salaryRealGrowth: n }), 0.005)}
          </Field>
          <Field label="Unused RRSP room ($)" hint="From CRA My Account">
            {numInput(p.rrspRoomNow ?? 0, (n) => setPerson(idx, { rrspRoomNow: n }), 1000)}
          </Field>
          <Field label="Unused TFSA room ($)">
            {numInput(p.tfsaRoomNow ?? 0, (n) => setPerson(idx, { tfsaRoomNow: n }), 1000)}
          </Field>
        </div>

        <div className="subhead">Account balances today</div>
        <div className="field-grid">
          <Field label="RRSP / RRIF">${numInput(bal.rrsp ?? 0, (n) => setBalances(idx, "rrsp", n), 1000)}</Field>
          <Field label="LIRA (locked)">{numInput(bal.lira ?? 0, (n) => setBalances(idx, "lira", n), 1000)}</Field>
          <Field label="DC / group RRSP">{numInput(bal.dcPension ?? 0, (n) => setBalances(idx, "dcPension", n), 1000)}</Field>
          <Field label="TFSA">{numInput(bal.tfsa ?? 0, (n) => setBalances(idx, "tfsa", n), 1000)}</Field>
          <Field label="Non-registered">{numInput(bal.unregistered?.balance ?? 0, (n) => setBalances(idx, "unregBal", n), 1000)}</Field>
          <Field label="Cost base (ACB)" hint="For capital gains on non-registered sales">
            {numInput(bal.unregistered?.acb ?? 0, (n) => setBalances(idx, "unregAcb", n), 1000)}
          </Field>
        </div>

        <div className="subhead">While working — annual savings</div>
        <div className="field-grid">
          {savingsFields(idx, "rrsp", "RRSP")}
          {savingsFields(idx, "tfsa", "TFSA")}
          {savingsFields(idx, "dc", "Workplace DC")}
        </div>
        <div className="field-grid" style={{ marginTop: "0.5rem" }}>
          <div className="full">
            <Check
              label="Reinvest RRSP tax refund into TFSA / non-registered"
              checked={p.reinvestRrspRefund ?? true}
              onChange={(v) => setPerson(idx, { reinvestRrspRefund: v })}
            />
          </div>
          <div className="full">
            <Check
              label="Unlock 50% of LIRA/DC into RRSP at LIF conversion (Ontario)"
              checked={p.lifUnlock50 ?? true}
              onChange={(v) => setPerson(idx, { lifUnlock50: v })}
            />
          </div>
          <div className="full">
            <Check
              label="RRIF minimums use younger spouse's age (lower forced withdrawals)"
              checked={p.rrifUseYoungerSpouseAge ?? true}
              onChange={(v) => setPerson(idx, { rrifUseYoungerSpouseAge: v })}
            />
          </div>
        </div>

        <div className="subhead">Government benefits & workplace pension</div>
        <div className="field-grid">
          <Field label="CPP at 65 (today $/yr)" hint="Service Canada estimate">
            {numInput(
              p.cpp?.annualAt65Today ?? 0,
              (n) => setPerson(idx, { cpp: { annualAt65Today: n, startAge: p.cpp?.startAge ?? 65 } }),
              100
            )}
          </Field>
          <Field label="CPP start age (60–70)">
            {numInput(p.cpp?.startAge ?? 65, (n) =>
              setPerson(idx, {
                cpp: { annualAt65Today: p.cpp?.annualAt65Today ?? 0, startAge: n },
              })
            )}
          </Field>
          <Field label="OAS start age (65–70)">
            {numInput(p.oas?.startAge ?? 65, (n) =>
              setPerson(idx, {
                oas: { startAge: n, residenceYears: p.oas?.residenceYears ?? 40 },
              })
            )}
          </Field>
          <Field label="Years lived in Canada" hint="OAS full at 40 years">
            {numInput(p.oas?.residenceYears ?? 40, (n) =>
              setPerson(idx, {
                oas: { startAge: p.oas?.startAge ?? 65, residenceYears: n },
              })
            )}
          </Field>
          <Field
            label="Defined-benefit pension ($/yr today)"
            hint="0 = no DB pension (also clears hidden annual accrual)"
          >
            {numInput(
              p.db?.currentAnnualEntitlementToday ?? 0,
              (n) =>
                setPerson(idx, {
                  // Truthy `db` object alone turns on payments; 0 must remove it entirely
                  // so sample-plan accrualPerYearToday cannot keep building a phantom pension.
                  db:
                    n > 0
                      ? {
                          currentAnnualEntitlementToday: n,
                          accrualPerYearToday: p.db?.accrualPerYearToday ?? 0,
                          startAge: p.db?.startAge ?? p.retirementAge,
                          indexedToCpi: p.db?.indexedToCpi ?? true,
                        }
                      : undefined,
                }),
              500
            )}
          </Field>
          <Field label="DB pension start age">
            {numInput(p.db?.startAge ?? p.retirementAge, (n) =>
              setPerson(idx, {
                db: p.db
                  ? {
                      ...p.db,
                      startAge: n,
                    }
                  : undefined,
              })
            )}
          </Field>
        </div>

        <div className="subhead">Expected investment return (decimal)</div>
        <p className="hint">Use 0.05 for 5%. Fees should already be netted out of these numbers.</p>
        <div className="field-grid">
          <Field label="RRSP / RRIF">{numInput(p.returns?.rrsp ?? 0.05, (n) => setReturn(idx, "rrsp", n), 0.005)}</Field>
          <Field label="TFSA">{numInput(p.returns?.tfsa ?? 0.05, (n) => setReturn(idx, "tfsa", n), 0.005)}</Field>
          <Field label="Non-registered">
            {numInput(p.returns?.unregistered ?? 0.06, (n) => setReturn(idx, "unregistered", n), 0.005)}
          </Field>
          <Field label="LIRA / LIF">{numInput(p.returns?.lira ?? 0.05, (n) => setReturn(idx, "lira", n), 0.005)}</Field>
        </div>
      </>
    );
  };

  return (
    <div className={`app${comfortableTables ? " comfortable-tables" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">Ontario · couple · lifecycle</div>
          <h1>
            <em>Horizon</em>
          </h1>
          <p className="brand-tagline">
            <span className="nowrap">
              Will this lifestyle last — and what&apos;s the tax-smarter way to fund it?
            </span>
            <br />
            <span className="nowrap">
              Full federal + Ontario tax, pension splitting, RRIF/LIF rules, and market stress tests.
            </span>
          </p>
        </div>
        <div className="top-actions">
          {busyLabel ? (
            <span className="status-pill busy pulse" data-testid="status-busy">
              {busyLabel}
            </span>
          ) : fundedOk === true ? (
            <span className="status-pill ok" data-testid="status-ok">
              Path funded
            </span>
          ) : fundedOk === false ? (
            <span className="status-pill err" data-testid="status-short">
              Shortfall risk
            </span>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onResetSample} data-testid="reset-sample">
            Reset sample
          </button>
        </div>
      </header>

      <div className="disclaimer" data-testid="disclaimer" role="note">
        <div>
          <strong>Estimates · not advice</strong>
          <div>
            Planning estimates under simplified Canadian tax rules (Ontario + federal 2026 baseline).
            Not financial, tax, or legal advice. Confirm material decisions with a qualified professional.
          </div>
        </div>
      </div>

      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div
          className={`issues ${validation.errors.length ? "has-errors" : "has-warnings"}`}
          data-testid="validation-issues"
        >
          {validation.errors.map((e, i) => (
            <div key={`e${i}`} className="issue error">
              {e.message}
            </div>
          ))}
          {validation.warnings.map((w, i) => (
            <div key={`w${i}`} className="issue warn">
              {w.message}
            </div>
          ))}
        </div>
      )}

      {stale && displayResult && running === "idle" && (
        <div className="stale-banner" data-testid="stale-banner">
          Inputs changed since the last analysis.{" "}
          <button type="button" className="link-btn" onClick={() => onAnalyze(false)}>
            Re-analyze plan
          </button>
        </div>
      )}

      <div className="shell">
        <aside className="panel" data-testid="inputs-panel">
          <div className="panel-head">
            <h2>Your plan</h2>
          </div>
          <nav className="section-nav" aria-label="Input sections">
            {(
              [
                ["household", "1 · Lifestyle"],
                ["alex", `2 · ${input.persons[0].name || "Spouse A"}`],
                ["jordan", `3 · ${input.persons[1].name || "Spouse B"}`],
                ["strategy", "4 · Tax strategy"],
                ["assumptions", "5 · Markets"],
                ["scenarios", "Scenarios"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`chip${tab === id ? " active" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="panel-body">
            {tab === "household" && (
              <>
                <p className="hint">
                  The lifestyle you want to fund every year, in <strong>today&apos;s dollars</strong>.
                  The engine indexes it with inflation.
                  <br />
                  Years are full calendar years starting <strong>January 1</strong> — if you open the
                  app mid-year, the default start is <strong>next</strong> January 1 (not a partial
                  current year).
                </p>
                <div className="field-rows" data-testid="lifestyle-fields">
                  <Field
                    layout="row"
                    label="Annual spending target"
                    hint="After-tax household lifestyle cost per year, in today's dollars"
                  >
                    {numInput(
                      input.spendingTargetToday,
                      (n) => {
                        markDirty();
                        setInput({ ...input, spendingTargetToday: n });
                      },
                      1000
                    )}
                  </Field>
                  <Field
                    layout="row"
                    label="Inflation rate"
                    hint="As a decimal: 0.021 means 2.1% per year"
                  >
                    {numInput(input.inflation ?? 0.021, (n) => {
                      markDirty();
                      setInput({ ...input, inflation: n });
                    }, 0.001)}
                  </Field>
                  <Field
                    layout="row"
                    label="Until younger spouse age"
                    hint="Last year of the projection is when the younger spouse turns this age (default 95). Not the retirement age."
                  >
                    {numInput(input.horizonAgeYoungerSpouse ?? 95, (n) => {
                      markDirty();
                      setInput({ ...input, horizonAgeYoungerSpouse: n });
                    })}
                  </Field>
                  <Field
                    layout="row"
                    label="Start year (Jan 1)"
                    hint="First full calendar year of the plan. Default is next Jan 1 if today is after January 1."
                  >
                    {numInput(input.startYear ?? 2026, (n) => {
                      markDirty();
                      setInput({ ...input, startYear: n });
                    })}
                  </Field>
                </div>
                <div className="subhead" style={{ marginTop: "1rem" }}>
                  First death (scoped)
                </div>
                <p className="hint">
                  Optional: model one spouse dying at year-end, with RRSP/TFSA rollover to the survivor,
                  ~60% CPP survivor boost, and reduced household spending after. Estimates only.
                </p>
                <div className="field-grid">
                  <Check
                    label="Model first death mid-plan"
                    checked={!!input.survivorship?.enabled}
                    onChange={(v) => {
                      markDirty();
                      setInput({
                        ...input,
                        survivorship: v
                          ? {
                              enabled: true,
                              firstDeathPerson: input.survivorship?.firstDeathPerson ?? 0,
                              firstDeathYear:
                                input.survivorship?.firstDeathYear ??
                                (input.startYear ?? 2026) + 20,
                              survivorSpendFrac: input.survivorship?.survivorSpendFrac ?? 0.7,
                            }
                          : undefined,
                      });
                    }}
                  />
                  {input.survivorship?.enabled && (
                    <>
                      <Field label="Who dies first">
                        <select
                          data-testid="first-death-person"
                          value={input.survivorship.firstDeathPerson}
                          onChange={(e) => {
                            markDirty();
                            setInput({
                              ...input,
                              survivorship: {
                                ...input.survivorship!,
                                enabled: true,
                                firstDeathPerson: Number(e.target.value) as 0 | 1,
                              },
                            });
                          }}
                        >
                          <option value={0}>{personNames[0]}</option>
                          <option value={1}>{personNames[1]}</option>
                        </select>
                      </Field>
                      <Field label="Death year (end of year)" hint="Calendar year">
                        {numInput(input.survivorship.firstDeathYear, (n) => {
                          markDirty();
                          setInput({
                            ...input,
                            survivorship: {
                              ...input.survivorship!,
                              enabled: true,
                              firstDeathYear: n,
                            },
                          });
                        })}
                      </Field>
                      <Field
                        label="Survivor spend fraction"
                        hint="0.7 = 70% of prior household lifestyle after death"
                      >
                        {numInput(
                          input.survivorship.survivorSpendFrac ?? 0.7,
                          (n) => {
                            markDirty();
                            setInput({
                              ...input,
                              survivorship: {
                                ...input.survivorship!,
                                enabled: true,
                                survivorSpendFrac: Math.min(1, Math.max(0.2, n)),
                              },
                            });
                          },
                          0.05
                        )}
                      </Field>
                    </>
                  )}
                </div>
                <AdvancedPlanOptions
                  input={input}
                  onChange={(next) => {
                    markDirty();
                    setInput(next);
                    inputRef.current = next;
                  }}
                />
              </>
            )}
            {tab === "alex" && personForm(0)}
            {tab === "jordan" && personForm(1)}
            {tab === "assumptions" && (
              <>
                <p className="hint">
                  Monte Carlo draws correlated market returns around your expected rates.
                  Volatility is a modelling choice, not a CRA figure.
                </p>
                <div className="field-grid">
                  <Field label="Number of market paths">{numInput(mcTrials, setMcTrials, 50)}</Field>
                  <Field label="Random seed" hint="Same seed → same results">
                    {numInput(seed, setSeed)}
                  </Field>
                  <Field label="Default volatility (σ)" hint="0.11 = 11% annual">
                    {numInput(defaultVol, setDefaultVol, 0.01)}
                  </Field>
                  <Field
                    label="MC inflation path"
                    full
                    hint="Fixed uses the lifestyle inflation rate; AR(1) adds stochastic inflation around the target"
                  >
                    <select
                      data-testid="mc-inflation-kind"
                      value={inflationKind}
                      onChange={(e) => setInflationKind(e.target.value as "fixed" | "ar1")}
                    >
                      <option value="fixed">Fixed (plan inflation)</option>
                      <option value="ar1">AR(1) stochastic</option>
                    </select>
                  </Field>
                </div>
              </>
            )}
            {tab === "strategy" && (
              <>
                <p className="hint">
                  After covering spending, the plan can deliberately withdraw more from RRSPs/RRIFs
                  up to a taxable-income ceiling, then park the after-tax surplus in TFSA / non-registered.
                  That &ldquo;meltdown&rdquo; often reduces the huge tax bill on the final RRIF.
                  <strong> Run full plan</strong> searches a flat C, then refines{" "}
                  <strong>age-banded ceilings</strong> (≤71 / ≤80 / later) with an{" "}
                  <strong>OAS soft-cap</strong> so meltdown does not deliberately enter clawback.
                </p>
                <div className="field-grid">
                  <Field
                    label="Income ceiling for top-ups ($ today)"
                    full
                    hint="Representative early-band C; Analyze overwrites with searched flat + bands"
                  >
                    {numInput(
                      input.strategy?.topUpCeilingToday ?? 0,
                      (n) => {
                        markDirty();
                        setInput({
                          ...input,
                          strategy: { ...(input.strategy ?? {}), topUpCeilingToday: n },
                        });
                      },
                      1000
                    )}
                  </Field>
                  <Check
                    label="OAS soft-cap (keep meltdown under clawback threshold)"
                    checked={input.strategy?.oasSoftCap !== false}
                    onChange={(v) => {
                      markDirty();
                      setInput({
                        ...input,
                        strategy: { ...(input.strategy ?? {}), oasSoftCap: v },
                      });
                    }}
                  />
                  <Check
                    label="TFSA-aware meltdown (scale top-ups to fit TFSA room)"
                    checked={input.strategy?.tfsaAwareMeltdown !== false}
                    onChange={(v) => {
                      markDirty();
                      setInput({
                        ...input,
                        strategy: { ...(input.strategy ?? {}), tfsaAwareMeltdown: v },
                      });
                    }}
                  />
                  <Field
                    label="Top-up priority"
                    full
                    hint="Who fills under their ceiling first when melting registered accounts"
                  >
                    <select
                      data-testid="topup-priority"
                      value={input.strategy?.topUpPriority ?? "higherReg"}
                      onChange={(e) => {
                        markDirty();
                        setInput({
                          ...input,
                          strategy: {
                            ...(input.strategy ?? {}),
                            topUpPriority: e.target.value as
                              | "equal"
                              | "prefer0"
                              | "prefer1"
                              | "higherReg",
                          },
                        });
                      }}
                    >
                      <option value="higherReg">Larger registered balance first</option>
                      <option value="equal">Equal order (A then B)</option>
                      <option value="prefer0">{personNames[0]} first</option>
                      <option value="prefer1">{personNames[1]} first</option>
                    </select>
                  </Field>
                  {input.strategy?.personCeilingsToday && (
                    <p className="hint full" data-testid="person-ceilings-summary">
                      Person ceilings (today&apos;s $): {personNames[0]}{" "}
                      {money(input.strategy.personCeilingsToday[0])} · {personNames[1]}{" "}
                      {money(input.strategy.personCeilingsToday[1])}
                      {" "}(auto-split from flat C by registered balances; surplus parks TFSA room-first)
                    </p>
                  )}
                  {input.strategy?.ceilingBands && input.strategy.ceilingBands.length > 0 && (
                    <p className="hint full" data-testid="ceiling-bands-summary">
                      Active age bands (today&apos;s $):{" "}
                      {input.strategy.ceilingBands
                        .map(
                          (b) =>
                            `≤${b.untilAge} → ${money(b.ceilingToday)}`
                        )
                        .join(" · ")}
                    </p>
                  )}
                  <Field
                    label="TFSA withdrawal policy"
                    full
                    hint="How discretionary withdrawals use TFSA vs registered/unregistered"
                  >
                    <select
                      data-testid="tfsa-level"
                      value={resolveTfsaLevel(input.strategy?.tfsaLevel)}
                      onChange={(e) => {
                        markDirty();
                        const tfsaLevel = e.target.value as TfsaLevel;
                        setInput({
                          ...input,
                          strategy: { ...(input.strategy ?? {}), tfsaLevel },
                        });
                      }}
                    >
                      {TFSA_LEVEL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="hint full" style={{ margin: 0 }} data-testid="tfsa-level-hint">
                    {TFSA_LEVEL_OPTIONS.find(
                      (o) => o.value === resolveTfsaLevel(input.strategy?.tfsaLevel)
                    )?.hint}
                  </p>
                  {(resolveTfsaLevel(input.strategy?.tfsaLevel) === "l3" ||
                    resolveTfsaLevel(input.strategy?.tfsaLevel) === "l4") && (
                    <Field
                      label="TFSA reserve (years of spending)"
                      hint="L3/L4 try to keep this many years of current spending in TFSA"
                    >
                      {numInput(
                        input.strategy?.tfsaReserveYears ?? 2,
                        (n) => {
                          markDirty();
                          setInput({
                            ...input,
                            strategy: {
                              ...(input.strategy ?? {}),
                              tfsaReserveYears: Math.max(0, Math.min(10, n)),
                            },
                          });
                        },
                        1
                      )}
                    </Field>
                  )}
                </div>
                <BenefitStartGridPanel
                  input={input}
                  onApply={(next) => {
                    markDirty();
                    setInput(next);
                    inputRef.current = next;
                  }}
                />
              </>
            )}
            {tab === "scenarios" && (
              <>
                <p className="hint">Save inputs + seed. Loading restores the couple and re-runs analysis.</p>
                <div className="field-grid">
                  <Field label="Scenario name" full>
                    <input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
                  </Field>
                </div>
                <div style={{ marginTop: "0.65rem" }}>
                  <button type="button" className="btn btn-primary" onClick={onSave} data-testid="save-scenario">
                    Save scenario
                  </button>
                </div>
                <div className="scenario-list" data-testid="scenario-list">
                  {scenarios.length === 0 && <p className="hint">No saved scenarios yet.</p>}
                  {scenarios.map((s) => (
                    <div className="scenario-item" key={s.id}>
                      <button type="button" className="linkish" onClick={() => onLoad(s.id)}>
                        {s.name}
                        <div style={{ fontSize: "0.72rem", color: "var(--fog)" }}>
                          {new Date(s.savedAt).toLocaleString()}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => {
                          deleteScenario(s.id);
                          refreshScenarios();
                        }}
                      >
                        Del
                      </button>
                    </div>
                  ))}
                </div>
                <ScenarioComparePanel scenarios={scenarios} currentInput={input} />
                <RunFingerprintPanel
                  inputs={input}
                  seed={seed}
                  mcTrials={mcTrials}
                  defaultVol={defaultVol}
                  onRestore={(next) => {
                    markDirty();
                    setInput(next.inputs);
                    inputRef.current = next.inputs;
                    setSeed(next.seed);
                    setMcTrials(next.mcTrials);
                    setDefaultVol(next.defaultVol);
                    setMc(null);
                  }}
                />
                <div className="field-grid" style={{ marginTop: "1rem" }}>
                  <Check
                    label="Comfortable table density (A5)"
                    checked={comfortableTables}
                    onChange={(v) => {
                      setComfortableTables(v);
                      try {
                        localStorage.setItem("horizon:comfortable-tables", v ? "1" : "0");
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="run-actions" data-testid="run-actions">
            <div className="run-action">
              <button
                type="button"
                className="btn btn-primary"
                disabled={running !== "idle" || !validation.ok}
                onClick={() => onAnalyze(false)}
                data-testid="run-analyze"
              >
                Run full plan
              </button>
              <p className="run-action-explain">
                Projects every year from the start date through the plan horizon: work and savings,
                retirement spending, RRIF/LIF rules, and full federal + Ontario tax.
                Also searches a tax-aware RRSP/RRIF top-up ceiling and compares it to a naive plan
                with no meltdown — so you see lifetime tax, estate, drawdown, and future tax brackets
                on the expected-return path.
              </p>
            </div>
            <div className="run-action">
              <button
                type="button"
                className="btn"
                disabled={running !== "idle" || !validation.ok}
                onClick={onMonteCarlo}
                data-testid="run-mc"
              >
                Market stress test
              </button>
              <p className="run-action-explain">
                Keeps the same plan and top-up ceiling, then re-runs many random market paths
                (Monte Carlo). Shows the chance your spending target is never missed, plus ranges
                for net worth and estate. Use this after a full plan run to stress-test markets —
                it does not re-search the tax strategy.
              </p>
            </div>
            {running !== "idle" && (
              <div className="run-progress" data-testid="run-progress">
                <div className="run-progress-bar-track">
                  <div
                    className="run-progress-bar-fill"
                    style={{
                      width: `${Math.round(Math.min(1, Math.max(0, progress?.fraction ?? 0)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="run-progress-meta">
                  <span className="hint" data-testid="run-progress-detail">
                    {progress?.detail ?? busyLabel ?? "Working…"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    data-testid="cancel-run"
                    onClick={cancelRunning}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="results-stack" data-testid="results-panel">
          {/* Box 1: headline results through strategy vs naive */}
          <section className="panel results-summary" data-testid="results-summary">
            <div className="panel-head">
              <h2>Results</h2>
              {elapsed != null && running === "idle" && (
                <span className="hint" style={{ margin: 0 }}>
                  {elapsed.toFixed(0)} ms
                </span>
              )}
            </div>
            <div className="panel-body">
              {error && (
                <div className="status-pill err" style={{ marginBottom: "1rem" }} data-testid="error">
                  {error}
                </div>
              )}

              {running === "analyze" && !displayResult && (
                <div className="empty-state" data-testid="loading-state">
                  <h2 className="pulse">Mapping your horizon…</h2>
                  <p>Running federal + Ontario tax, pension split, and strategy search on the sample couple.</p>
                </div>
              )}

              {!displayResult && !mc && running === "idle" && (
                <div className="empty-state" data-testid="empty-state">
                  <h2>Ready when you are.</h2>
                  <p>
                    Fix any input errors, then press <strong>Run full plan</strong>. Sample couple loads
                    automatically on first open.
                  </p>
                </div>
              )}

              {(displayResult || mc) && (
                <>
                  <ExportPlanBar
                    input={input}
                    personNames={personNames}
                    det={displayResult}
                    tune={tune}
                    mc={mc}
                  />
                  <MetricsGuide />
                  <ShortfallPanel
                    input={input}
                    det={displayResult}
                    mc={mc}
                    onApply={(next) => {
                      markDirty();
                      setInput(next);
                      inputRef.current = next;
                    }}
                  />
                  <div className="hero-metrics" data-testid="hero-metrics">
                    <div className="metric">
                      <div className="metric-main">
                        <div className="label">
                          <GlossaryTip term="successRate">Funding outlook</GlossaryTip>
                        </div>
                        <div className="value cyan" data-testid="success-rate">
                          {mc
                            ? pct(mc.successRate, 1)
                            : displayResult && !displayResult.failedAnyYear
                              ? "Funded"
                              : "Short"}
                        </div>
                      </div>
                      <div className="metric-note">
                        <div className="sub">
                          {mc ? (
                            <>
                              {mc.trials} random markets
                              <br />
                              seed {mc.seed}
                            </>
                          ) : (
                            "Expected-return path"
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="metric">
                      <div className="metric-main">
                        <div className="label">
                          {mc ? "Median after-tax estate" : "After-tax estate"}{" "}
                          <UnitBadge unit="real" />
                        </div>
                        <div className="value lime" data-testid="estate-real">
                          {money(mc?.estateReal.p50 ?? displayResult?.afterTaxEstateReal ?? 0, {
                            compact: true,
                          })}
                        </div>
                      </div>
                      <div className="metric-note">
                        <div className="sub">
                          {mc ? (
                            <>
                              across {mc.trials} paths
                              <br />
                              worse {money(mc.estateReal.p10, { compact: true })} · better{" "}
                              {money(mc.estateReal.p90, { compact: true })}
                            </>
                          ) : (
                            "end of plan · deflated"
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="metric">
                      <div className="metric-main">
                        <div className="label">
                          <GlossaryTip term="livingTax">Lifetime tax</GlossaryTip>{" "}
                          <UnitBadge unit="nominal" />
                        </div>
                        <div className="value mag" data-testid="lifetime-tax">
                          {money(mc?.lifetimeTax.p50 ?? displayResult?.lifetimeTax ?? 0, {
                            compact: true,
                          })}
                        </div>
                      </div>
                      <div className="metric-note">
                        <div className="sub">
                          {mc ? "MC median living years" : "living years only · not estate tax"}
                        </div>
                      </div>
                    </div>
                    <div className="metric">
                      <div className="metric-main">
                        <div className="label">
                          {mc ? "Typical first shortfall" : "First shortfall year"}
                        </div>
                        <div className="value amber" data-testid="first-shortfall">
                          {(() => {
                            if (mc) {
                              const typ = typicalFirstShortfallYear(mc.failures);
                              return typ != null ? String(typ) : "None";
                            }
                            if (
                              displayResult?.failedAnyYear &&
                              displayResult.firstFailureYear != null
                            ) {
                              return String(displayResult.firstFailureYear);
                            }
                            return displayResult ? "None" : "—";
                          })()}
                        </div>
                      </div>
                      <div className="metric-note">
                        <div className="sub">
                          {(() => {
                            if (mc) {
                              const typ = typicalFirstShortfallYear(mc.failures);
                              const nFail = countFailingTrials(mc.failures);
                              if (typ == null) return "no failing trials";
                              return (
                                <>
                                  among failing paths
                                  <br />
                                  {pct(failureRate(mc), 0)} of trials fail
                                  {nFail > 0 ? ` · n=${nFail}` : ""}
                                </>
                              );
                            }
                            if (displayResult?.failedAnyYear) {
                              return "expected-return path · first miss";
                            }
                            if (displayResult) return "fully funded on expected path";
                            return "run full plan";
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="compare-grid" data-testid="strategy-compare">
                    <div className="compare-card win">
                      <h3>
                        Tax-aware strategy{" "}
                        <GlossaryTip term="meltdown">
                          <span className="sr-only">meltdown</span>
                        </GlossaryTip>
                      </h3>
                      <div className="row">
                        <span>
                          <GlossaryTip term="topUpCeiling">Top-up ceiling</GlossaryTip>{" "}
                          <UnitBadge unit="real" />
                        </span>
                        <span className="big" data-testid="ceiling-value">
                          {money(tune?.bestCeilingToday ?? input.strategy?.topUpCeilingToday ?? 0)}
                        </span>
                      </div>
                      {(() => {
                        const ext = tune as TuneResult & {
                          bestCeilingBands?: Array<{ untilAge: number; ceilingToday: number }>;
                          oasSoftCap?: boolean;
                        };
                        return (
                          <>
                            {ext?.bestCeilingBands && ext.bestCeilingBands.length > 0 && (
                              <div className="row" data-testid="ceiling-bands-row">
                                <span>Age-banded C</span>
                                <span style={{ fontSize: "0.78rem", textAlign: "right" }}>
                                  {ext.bestCeilingBands
                                    .map(
                                      (b) =>
                                        `≤${b.untilAge} ${money(b.ceilingToday, { compact: true })}`
                                    )
                                    .join(" · ")}
                                </span>
                              </div>
                            )}
                            {ext && ext.oasSoftCap !== false && (
                              <div className="row">
                                <span>OAS soft-cap</span>
                                <span data-testid="oas-soft-cap-flag">On</span>
                              </div>
                            )}
                            {input.strategy?.personCeilingsToday && (
                              <div className="row" data-testid="person-ceilings-row">
                                <span>Person C</span>
                                <span style={{ fontSize: "0.78rem", textAlign: "right" }}>
                                  {money(input.strategy.personCeilingsToday[0], { compact: true })} /{" "}
                                  {money(input.strategy.personCeilingsToday[1], { compact: true })}
                                </span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      <div className="row">
                        <span>
                          Lifetime tax <UnitBadge unit="nominal" />
                        </span>
                        <span data-testid="tuned-tax">
                          {money((tune?.tuned ?? displayResult)!.lifetimeTax)}
                        </span>
                      </div>
                      <div className="row">
                        <span>
                          <GlossaryTip term="estateTax">Estate tax at death</GlossaryTip>{" "}
                          <UnitBadge unit="nominal" />
                        </span>
                        <span data-testid="tuned-estate-tax">
                          {money(estateTaxOf(tune?.tuned ?? displayResult!))}
                        </span>
                      </div>
                      <div className="row">
                        <span>
                          Estate <UnitBadge unit="real" />
                        </span>
                        <span data-testid="tuned-estate">
                          {money((tune?.tuned ?? displayResult)!.afterTaxEstateReal)}
                        </span>
                      </div>
                      {tune && (
                        <div className="row">
                          <span>
                            <GlossaryTip term="totalTaxSaved">Tax saved vs naive</GlossaryTip>
                          </span>
                          <span style={{ color: "var(--lime)" }} data-testid="tax-saving">
                            {money(tune.totalTaxSaving)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="compare-card">
                      <h3>
                        <GlossaryTip term="naive">Naive baseline</GlossaryTip> (no meltdown)
                      </h3>
                      {tune ? (
                        <>
                          <div className="row">
                            <span>
                              Lifetime tax <UnitBadge unit="nominal" />
                            </span>
                            <span data-testid="naive-tax">{money(tune.naive.lifetimeTax)}</span>
                          </div>
                          <div className="row">
                            <span>
                              <GlossaryTip term="estateTax">Estate tax at death</GlossaryTip>{" "}
                              <UnitBadge unit="nominal" />
                            </span>
                            <span data-testid="naive-estate-tax">
                              {money(estateTaxOf(tune.naive))}
                            </span>
                          </div>
                          <div className="row">
                            <span>
                              Estate <UnitBadge unit="real" />
                            </span>
                            <span data-testid="naive-estate">{money(tune.naive.afterTaxEstateReal)}</span>
                          </div>
                          <div className="row">
                            <span>Extra estate from strategy</span>
                            <span style={{ color: "var(--cyan)" }} data-testid="estate-gain">
                              {money(tune.estateRealGain)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="hint">Run full plan to compare against spending-only withdrawals.</p>
                      )}
                    </div>
                  </div>
                  <SpendToZeroPanel
                    input={input}
                    tune={tune}
                    onApplySpend={(spend) => {
                      markDirty();
                      const next = { ...inputRef.current, spendingTargetToday: spend };
                      setInput(next);
                      inputRef.current = next;
                    }}
                  />
                </>
              )}
            </div>
          </section>

          {/* Box 2: deep dive — tax why, brackets, charts, drawdown */}
          {(displayResult || mc) && (
            <section className="panel results-detail" data-testid="results-detail">
              <div className="panel-head">
                <h2>Plan detail</h2>
              </div>
              <div className="panel-body">
                <p className="hint plan-detail-nav">
                  Sections:{" "}
                  <a href="#plan-tax">Tax</a>
                  {" · "}
                  <a href="#plan-charts">Charts</a>
                  {" · "}
                  <a href="#plan-cashflow">Cash flow</a>
                  {" · "}
                  <a href="#plan-tfsa">TFSA</a>
                  {" · "}
                  <a href="#plan-drawdown">Drawdown</a>
                </p>
                {tune && (
                  <CollapsibleSection id="plan-tax" title="Tax strategy & brackets" defaultOpen>
                    <TaxStrategyExplain
                      tune={tune}
                      result={displayResult ?? tune.tuned}
                      personNames={personNames}
                    />
                  </CollapsibleSection>
                )}

                <CollapsibleSection id="plan-charts" title="Net worth & withdrawals" defaultOpen>
                  <FanChart mc={mc} det={displayResult} personNames={personNames} />
                  {displayResult && <WithdrawalStackChart result={displayResult} />}
                </CollapsibleSection>

                {displayResult && (
                  <CollapsibleSection id="plan-cashflow" title="Year-by-year cash flow" defaultOpen>
                    <CashflowTable result={displayResult} />
                  </CollapsibleSection>
                )}

                {displayResult && (
                  <CollapsibleSection id="plan-tfsa" title="TFSA room" defaultOpen={false}>
                    <TfsaRoomPanel result={displayResult} personNames={personNames} />
                  </CollapsibleSection>
                )}

                {displayResult && (
                  <CollapsibleSection id="plan-drawdown" title="Drawdown ledgers" defaultOpen={false}>
                    <DrawdownDetail result={displayResult} personNames={personNames} />
                  </CollapsibleSection>
                )}

                <CollapsibleSection id="plan-sensitivity" title="Sensitivity" defaultOpen={false}>
                  <SensitivityPanel input={input} />
                </CollapsibleSection>

                {displayResult?.housingEstateReal != null && displayResult.housingEstateReal > 0 && (
                  <p className="hint" data-testid="housing-estate-note">
                    Housing in terminal estate (real):{" "}
                    <strong>{money(displayResult.housingEstateReal)}</strong>
                  </p>
                )}

                {displayResult?.firstDeathYear != null && (
                  <p className="hint" data-testid="first-death-note">
                    First death modeled end of <strong>{displayResult.firstDeathYear}</strong>
                    {displayResult.firstDeathPerson != null
                      ? ` (${personNames[displayResult.firstDeathPerson]})`
                      : ""}
                    . Survivor spending step-down and asset rollover applied afterward.
                  </p>
                )}
              </div>
            </section>
          )}
        </main>
      </div>

      <p className="footer-note" data-testid="policy-footer">
        Horizon · estimates only · tax/policy baseline{" "}
        <strong>{POLICY_BASELINE.taxYear}</strong> ({POLICY_BASELINE.jurisdiction}, retrieved{" "}
        {POLICY_BASELINE.retrievedOn}) · RRIF / LIF / OAS · see{" "}
        <code>docs/ANNUAL-POLICY-REFRESH.md</code>
        {new Date().getFullYear() > POLICY_BASELINE.taxYear ? (
          <span className="policy-stale-warn">
            {" "}
            · device year {new Date().getFullYear()} is past baseline — refresh constants when
            possible
          </span>
        ) : null}
      </p>
    </div>
  );
}
