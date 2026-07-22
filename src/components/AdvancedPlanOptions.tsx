import type { HouseholdInput, OneTimeGoal, SpendPhase } from "../simulate";

/** UI for P2 advanced plan options: housing, GIS, payroll, phases, goals, sleeves, bands. */
export function AdvancedPlanOptions({
  input,
  onChange,
}: {
  input: HouseholdInput;
  onChange: (next: HouseholdInput) => void;
}) {
  const set = (patch: Partial<HouseholdInput>) => onChange({ ...input, ...patch });

  return (
    <div className="advanced-plan" data-testid="advanced-plan-options">
      <div className="subhead" style={{ marginTop: "1rem" }}>
        Advanced (P2 modules)
      </div>
      <p className="hint">
        Optional modules: housing, GIS, payroll, spend phases, one-time goals, equity sleeves, and
        age-banded top-up ceilings. Estimates only.
      </p>

      <div className="subhead">Housing</div>
      <div className="field-grid">
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!input.housing?.enabled}
            onChange={(e) =>
              set({
                housing: e.target.checked
                  ? {
                      enabled: true,
                      valueToday: input.housing?.valueToday ?? 800_000,
                      realGrowth: input.housing?.realGrowth ?? 0.01,
                      sellYear: input.housing?.sellYear,
                      includeInEstate: input.housing?.includeInEstate ?? true,
                    }
                  : undefined,
              })
            }
          />
          <span>Include primary residence</span>
        </label>
        {input.housing?.enabled && (
          <>
            <label className="field field-stack">
              <span className="field-label-text">Home value (today&apos;s $)</span>
              <input
                type="number"
                value={input.housing.valueToday}
                step={10000}
                onChange={(e) =>
                  set({
                    housing: {
                      ...input.housing!,
                      valueToday: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field field-stack">
              <span className="field-label-text">Real growth (e.g. 0.01)</span>
              <input
                type="number"
                step={0.005}
                value={input.housing.realGrowth ?? 0.01}
                onChange={(e) =>
                  set({
                    housing: {
                      ...input.housing!,
                      realGrowth: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field field-stack">
              <span className="field-label-text">Sell year (optional)</span>
              <input
                type="number"
                value={input.housing.sellYear ?? ""}
                placeholder="none"
                onChange={(e) => {
                  const v = e.target.value;
                  set({
                    housing: {
                      ...input.housing!,
                      sellYear: v === "" ? undefined : Number(v),
                    },
                  });
                }}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={input.housing.includeInEstate !== false}
                onChange={(e) =>
                  set({
                    housing: {
                      ...input.housing!,
                      includeInEstate: e.target.checked,
                    },
                  })
                }
              />
              <span>Include in estate if not sold</span>
            </label>
          </>
        )}
      </div>

      <div className="subhead">Benefits & payroll</div>
      <div className="field-grid">
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!input.gis?.enabled}
            onChange={(e) => set({ gis: e.target.checked ? { enabled: true } : undefined })}
          />
          <span>Rough GIS estimate (low income + OAS)</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!input.payroll?.enabled}
            onChange={(e) => set({ payroll: e.target.checked ? { enabled: true } : undefined })}
          />
          <span>Approx employee CPP/EI on salary</span>
        </label>
      </div>

      <div className="subhead">Portfolio sleeves</div>
      <div className="field-grid">
        <label className="field field-stack full">
          <span className="field-label-text">Equity weight (0–1, blank = use account returns)</span>
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={input.portfolio?.equityWeight ?? ""}
            placeholder="off"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") set({ portfolio: undefined });
              else
                set({
                  portfolio: {
                    equityWeight: Math.min(1, Math.max(0, Number(v))),
                    equityReturn: input.portfolio?.equityReturn ?? 0.07,
                    bondReturn: input.portfolio?.bondReturn ?? 0.03,
                  },
                });
            }}
          />
        </label>
      </div>

      <div className="subhead">Spend phases (younger spouse age)</div>
      <p className="hint">Leave empty to use the single lifestyle target. Example: go-go / slow-go.</p>
      <PhaseEditor
        phases={input.spendPhases ?? []}
        onChange={(spendPhases) => set({ spendPhases: spendPhases.length ? spendPhases : undefined })}
      />

      <div className="subhead">One-time goals</div>
      <GoalsEditor
        goals={input.oneTimeGoals ?? []}
        onChange={(oneTimeGoals) =>
          set({ oneTimeGoals: oneTimeGoals.length ? oneTimeGoals : undefined })
        }
      />

      <div className="subhead">Age-banded top-up ceiling (older spouse age)</div>
      <p className="hint">
        Optional. Overrides a single C when set — e.g. higher meltdown before 71, lower later.
      </p>
      <BandsEditor
        bands={input.strategy?.ceilingBands ?? []}
        onChange={(ceilingBands) =>
          set({
            strategy: {
              ...(input.strategy ?? {}),
              ceilingBands: ceilingBands.length ? ceilingBands : undefined,
            },
          })
        }
      />
    </div>
  );
}

function PhaseEditor({
  phases,
  onChange,
}: {
  phases: SpendPhase[];
  onChange: (p: SpendPhase[]) => void;
}) {
  return (
    <div className="mini-list" data-testid="spend-phases">
      {phases.map((p, i) => (
        <div className="mini-row" key={i}>
          <input
            type="number"
            title="From age"
            value={p.fromAgeYounger}
            onChange={(e) => {
              const next = [...phases];
              next[i] = { ...p, fromAgeYounger: Number(e.target.value) };
              onChange(next);
            }}
          />
          <input
            type="number"
            title="Spend today $"
            step={1000}
            value={p.spendToday}
            onChange={(e) => {
              const next = [...phases];
              next[i] = { ...p, spendToday: Number(e.target.value) };
              onChange(next);
            }}
          />
          <button type="button" className="btn btn-danger" onClick={() => onChange(phases.filter((_, j) => j !== i))}>
            Del
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([
            ...phases,
            { fromAgeYounger: phases.length ? 75 : 55, spendToday: 90_000 },
          ])
        }
      >
        Add phase
      </button>
    </div>
  );
}

function GoalsEditor({
  goals,
  onChange,
}: {
  goals: OneTimeGoal[];
  onChange: (g: OneTimeGoal[]) => void;
}) {
  return (
    <div className="mini-list" data-testid="one-time-goals">
      {goals.map((g, i) => (
        <div className="mini-row" key={i}>
          <input
            type="number"
            title="Year"
            value={g.year}
            onChange={(e) => {
              const next = [...goals];
              next[i] = { ...g, year: Number(e.target.value) };
              onChange(next);
            }}
          />
          <input
            type="number"
            title="Amount today $"
            step={1000}
            value={g.amountToday}
            onChange={(e) => {
              const next = [...goals];
              next[i] = { ...g, amountToday: Number(e.target.value) };
              onChange(next);
            }}
          />
          <input
            type="text"
            title="Label"
            value={g.label ?? ""}
            placeholder="label"
            onChange={(e) => {
              const next = [...goals];
              next[i] = { ...g, label: e.target.value };
              onChange(next);
            }}
          />
          <button type="button" className="btn btn-danger" onClick={() => onChange(goals.filter((_, j) => j !== i))}>
            Del
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([...goals, { year: new Date().getFullYear() + 5, amountToday: 40_000, label: "Goal" }])
        }
      >
        Add goal
      </button>
    </div>
  );
}

function BandsEditor({
  bands,
  onChange,
}: {
  bands: Array<{ untilAge: number; ceilingToday: number }>;
  onChange: (b: Array<{ untilAge: number; ceilingToday: number }>) => void;
}) {
  return (
    <div className="mini-list" data-testid="ceiling-bands">
      {bands.map((b, i) => (
        <div className="mini-row" key={i}>
          <input
            type="number"
            title="Until age"
            value={b.untilAge}
            onChange={(e) => {
              const next = [...bands];
              next[i] = { ...b, untilAge: Number(e.target.value) };
              onChange(next);
            }}
          />
          <input
            type="number"
            title="Ceiling today $"
            step={5000}
            value={b.ceilingToday}
            onChange={(e) => {
              const next = [...bands];
              next[i] = { ...b, ceilingToday: Number(e.target.value) };
              onChange(next);
            }}
          />
          <button type="button" className="btn btn-danger" onClick={() => onChange(bands.filter((_, j) => j !== i))}>
            Del
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([
            ...bands,
            { untilAge: bands.length ? 120 : 71, ceilingToday: bands.length ? 60_000 : 95_000 },
          ])
        }
      >
        Add band
      </button>
    </div>
  );
}
