# Horizon — Ontario Couple Retirement Planner

**Product name:** Horizon  
**Version:** 1.0 (implemented SPA + engine)  
**Date:** 2026-07-21  
**Status:** Living product design. Engine policy numbers are pinned in `src/constants-2026.ts` with sources and retrieval dates. UI and behaviours below describe **what the app should do** as of the current codebase and product conversations.

**Disclaimer (always on-screen):** outputs are planning **estimates**, not financial, tax, or legal advice.

---

## 1. Purpose

Horizon projects a **two-person Ontario household** from today through end of plan (default: younger spouse age 95), covering **accumulation and decumulation**. It models RRSPs/RRIFs, LIRAs/LIFs, TFSAs, DC pensions, unregistered accounts, DB pensions, CPP, and OAS under **federal + Ontario** tax law, with inflation, returns, strategy search, and Monte Carlo.

**Primary questions it answers:**

1. Given what we have, earn, and save — **can we fund this lifestyle for life?**  
2. **Where does the money come from** each year (which person, which account), and what balances remain?  
3. **What withdrawal / RRSP meltdown strategy** improves lifetime tax + estate vs a naive baseline — and **why** (including future tax-bracket placement)?  
4. Under random markets, **what is the success probability** of never missing the spending target?

---

## 2. Locked product decisions

| # | Decision |
|---|----------|
| D1 | **Full lifecycle:** accumulation + decumulation; each spouse has own birth year and retirement age; mixed working/retired years allowed. |
| D2 | **Spending:** one household after-tax target in **today’s dollars**, CPI-indexed along the simulated path. |
| D3 | **Strategy:** tax-aware **RRSP/RRIF top-up ceiling C** (meltdown heuristic), always compared to **naive C = 0**; not claimed as a global multi-decade optimum. |
| D4 | **Working savings:** fixed $ or % of salary per account; overflow RRSP → TFSA → unregistered; RRSP refund reinvest toggle. |
| D5 | **Survivors / first death:** **scoped support** — optional first-death year with asset rollover, spend step-down, and simplified CPP survivor boost. Stochastic multi-path longevity and full estate/probate law remain roadmap. |
| D6 | **MC failure:** first year target cannot be funded after exhausting accounts; headline = share of trials that never fail. |
| D7 | **Client-side only:** Vite + React SPA; no backend; data stays on device; seeded RNG for reproducibility. |
| D8 | **Product shell:** distinctive non-generic-finance UI (“Horizon”), not a stock banking dashboard. |
| D9 | **First open:** sample couple pre-loaded and **auto-analyzed** so results appear without hunting run buttons. |
| D10 | **Primary action:** **Run full plan** (deterministic path + strategy tune vs naive). **Market stress test** = Monte Carlo (secondary). |
| D13 | **Simulation years are full calendar years from Jan 1.** Default start year is the **next** Jan 1 if the app is opened after January 1 (mid-year included). |
| D11 | **Drawdown transparency:** per-year funding by **person × account**, plus multi-year **balance tracking**; full-page tables without nested scroll. |
| D12 | **Tax transparency:** explain why tuned beats naive; show **future statutory federal/Ontario bracket estimates** along the path (year-scaled policy). |

---

## 3. Defaults & modelling assumptions

| # | Assumption | Notes |
|---|-----------|--------|
| A1 | Horizon = younger spouse turns **95** (UI: 80–105). | |
| A2 | DC / Group RRSP included (→ LIF). | |
| A3 | CPP/OAS start ages are **user inputs**; UI also offers a **bounded start-age grid** on the expected path (not a global multi-objective optimizer). | |
| A4 | Unregistered return split: interest / eligible dividends / realized gains (user defaults). Non-eligible dividends, corporations: out of scope. | |
| A5 | Fees embedded in expected returns (no separate MER field). | |
| A6 | Default inflation **2.1%** fixed; AR(1) supported in engine, UI exposes fixed rate primarily. | |
| A7 | Default MC: UI often uses **~400 trials** for snappiness (editable); engine tests use 2,000; seed editable. Default vol ~11%, market correlation 0.85. | |
| A8 | Investments are **account-level** µ/σ — not a stock/ETF ticker portfolio with auto market data (discussed; not v1). | |

---

## 4. Platform & architecture

### 4.1 Stack

- **UI:** React + TypeScript + Vite (`index.html`, `src/main.tsx`, `src/App.tsx`)  
- **Styles:** `src/styles/global.css` — dark mesh, Instrument Serif / Outfit / JetBrains Mono, lime/cyan/magenta accents  
- **Engine:** pure TS modules, public surface `src/engine-entry.ts`  
- **Tests:** Vitest — `tests/*` (engine) + `src/lib/*.test.ts` (mappers / analysis)  
- **Smoke:** `scripts/ui-smoke.mjs` (Playwright) against `npm run dev`

### 4.2 Module map

| Layer | Files | Role |
|-------|--------|------|
| Constants | `constants-2026.ts` | Sourced 2026 policy (brackets, OHP, RRIF, FSRA LIF max, anchors) |
| Policy | `policy.ts` | CPI-scale indexed params; freeze statutory freezes (bracket creep) |
| Tax | `tax.ts` | Federal + ON428-style tax, OAS clawback, pension-split search |
| Simulate | `simulate.ts` | Lifetime path, solver, top-up, balances, year rows |
| MC / tune | `mc.ts` | Seeded lognormal paths, AR(1) inflation, `tuneStrategy` |
| Analysis (UI) | `lib/analysis.ts` | `analyzePlan`, MC prep with tuned ceiling |
| View models | `lib/drawdown.ts`, `taxExplain.ts`, `cashflow.ts`, `validate.ts`, `savings.ts` | Pure mappers for UI |
| UI | `App.tsx`, `components/*`, `pages/DrawdownFullPage.tsx` | Inputs, results, full tables |
| Persistence | `lib/scenarioStore.ts`, `lastPlanStore.ts` | localStorage scenarios; session last plan |

### 4.3 Performance & quality modes

- Deterministic / tuner: **`solverQuality: "thorough"`**  
- Monte Carlo trials: **`"fast"`** (within ~0.5% lifetime tax of thorough per tests)  
- Strategy search: coarse then fine grid on ceiling C  
- Target: large MC runs under a few seconds on a laptop; Web Worker optional if main thread freezes  

### 4.4 Routing

- Main planner: `#/` or empty hash  
- Full withdrawals table: `#/drawdown/withdrawals`  
- Full balances table: `#/drawdown/balances`  
- Full pages use **document scroll** (no nested max-height scroll box); sticky headers  

---

## 5. Inputs the user can set

Guided sections (progressive chips):

### 5.1 Lifestyle (household)

- Annual spending target ($ today)  
- Inflation (decimal)  
- **Plan until younger spouse age** — last year of the projection (when the younger spouse turns this age); not retirement age  
- **Simulation start year (Jan 1)** — first **full** calendar year of the plan  

**Start-year default:** the model is annual from January 1. If “today” is already January 1, default start year is the current year; **any later date (including mid-year) defaults to next calendar year** so year 1 is a complete Jan 1–Dec 31 year, not a partial current year. Users may still override the field.

**Validation:** block nonsense (zero spend, bad horizon, ACB > unregistered balance, invalid CPP/OAS ages); warn on extreme returns (e.g. 5.5 entered instead of 0.055). Stale banner after edits until re-analyze.

### 5.2 Each spouse

- Name, birth year, retirement age  
- Salary today, real growth above inflation  
- RRSP / TFSA room  
- Balances: RRSP, LIRA, DC, TFSA, unregistered + ACB  
- **Savings while working:** none / fixed $ / % of salary for RRSP, TFSA, DC  
- Toggles: reinvest RRSP refund; **Ontario 50% LIF unlock**; **RRIF mins use younger spouse age**  
- CPP at 65 (today $) + start age; OAS start age + residence years  
- DB pension annual (today $) + start age  
- Expected **nominal** returns by account (decimal)  

### 5.3 Tax strategy

- Manual top-up ceiling C (today $); **Analyze plan** searches a strong C automatically  

### 5.4 Markets (MC)

- Number of paths, RNG seed, default volatility σ  

### 5.5 Scenarios

- Save name + **inputs + seed** to localStorage (versioned)  
- Load restores inputs and **re-runs analysis** (results never look permanently empty)  
- Delete  

### 5.6 Sample couple

- Pre-loaded Alex & Jordan; **Reset sample** restores and re-analyzes  

---

## 6. Yearly engine (order of operations)

Annual steps; age in year *t* = *t* − birth year (age attained Dec 31). Money simulated **nominal**; reported real metrics deflated by CPI path. Mid-year convention:  
`B1 = B0·(1+r) + netFlow·(1+r/2)`.

Each year:

1. **Conversions:** RRSP→RRIF by age rules; LIRA/DC→LIF at conversion age with optional 50% unlock; benefit streams start.  
2. **Room accrual:** RRSP (18% earned income − PA, dollar cap); TFSA limit + prior withdrawals.  
3. **Employment / DB accrual** while working.  
4. **Contributions** + refund landing + overflow.  
5. **Guaranteed income + forced mins:** DB, CPP, OAS; RRIF/LIF minimums (Jan 1 age; younger-spouse election); Ontario LIF **max** = max(FSRA factor × balance, prior-year investment growth).  
6. **Unregistered distributions** on opening balance (taxable).  
7. **Withdrawal solver:** gross withdrawals so after-tax cash ≈ spending target; allocate across spouses/accounts; pension split search.  
8. **Tax** per spouse (federal + Ontario + OAS clawback).  
9. **Surplus** → TFSA then unregistered; shortfall after exhaustion → **failed** year.  
10. **Growth** applied; CPI and ages advance.  

### 6.1 Solver notes (implemented)

- Pension split optimized with cadence + local refine (not full nested search every bisection candidate).  
- Withdrawal root: Illinois false position + warm start.  
- Spouse allocation equalizes taxable income (proxy for marginal equalization).  
- Account order for discretionary: unregistered → registered → LIF → TFSA (with gain fraction on unregistered).  
- **Phase 2 top-up:** after spending solved, withdraw more registered dollars up to ceiling C; surplus reinvested.  

---

## 7. Decumulation strategy

### 7.1 Top-up ceiling C

In retirement, after funding spending, deliberately withdraw additional RRSP/RRIF until taxable income reaches **C** (today’s $, CPI-indexed). After-tax excess → TFSA / unregistered. Goal: smooth taxable income and shrink terminal registered tax.

### 7.2 Tuning (`tuneStrategy` / `analyzePlan`)

- Search C on the **deterministic** path (coarse then fine grid).  
- Lexicographic objective: (1) maximize fully funded years, (2) maximize real after-tax estate.  
- Always produce **naive C = 0** side-by-side.  
- **Tax saved** metric includes **estate tax** (meltdown front-loads living tax).  

### 7.3 Honesty

UI must state this is a **heuristic vs no-meltdown**, not a proof of global multi-year optimality.

---

## 8. Tax engine (per spouse, per year)

Pure functions over year-scaled `YearPolicy`.

**Federal:** progressive brackets (2026 lowest rate 14% under Bill C-4 framing); BPA with phase-out; age amount; pension amount; eligible dividend gross-up + DTC; 50% capital gains inclusion; OAS recovery tax (also reduces net income).  

**Ontario:** brackets (partial freezes on top thresholds); credits; **surtax** before DTC; tax reduction; **Health Premium** (frozen bands); eligible dividend DTC.  

**Household:** pension income splitting search (DB any age; RRIF/LIF 65+), both directions, fine grid.  

**Simplifications (documented):** credits at lowest rate; no unused credit transfers; no AMT/TOSI/medical/charitable; same-year OAS clawback model; no CPP/EI payroll in working years; estate tax on unsplit final-year income (slight understatement).  

---

## 9. Economics

- **Returns:** user nominal arithmetic µ; MC lognormal with mean preserved; single-factor correlation ρ.  
- **σ = 0:** bit-identical to deterministic path.  
- **Inflation:** fixed or AR(1); drives spending, salaries, benefits, indexed policy. Frozen policy params capture bracket creep.  

---

## 10. Monte Carlo

- Seeded mulberry32 + per-trial streams.  
- Strategy fixed after deterministic tune (no per-trial re-tune / foresight).  
- **MC must use the same ceiling C** shown in the strategy UI (`prepareMonteCarloRun`).  
- Outputs: success rate, failure years, real net-worth percentiles, estate distribution, lifetime tax stats.  

---

## 11. Results the UI must show

After primary analysis (auto or **Analyze plan**):

### 11.1 Headline metrics

- Funding outlook (deterministic funded / short; MC success %)  
- After-tax estate (real)  
- Lifetime tax (living years; MC median when run)  
- Lifestyle target  

### 11.2 Strategy comparison

- Tuned: ceiling C, lifetime tax, estate, tax saved vs naive  
- Naive: lifetime tax, estate, estate gain from tuning  

### 11.3 Why this is the tax-minimizing path

- Metrics: C, tax saved (living+estate), estate gain, living-year tax Δ  
- Side-by-side: top-up years, OAS clawback years, peak taxable, share of person-years in federal 29%+ bands  
- Plain-language bullets **grounded in those metrics**  
- Disclaimer: heuristic vs C=0, not global optimum  

### 11.4 Future tax-bracket estimates

- One row per retirement year  
- Per spouse: age, taxable income (engine field), **federal band + year-scaled range**, **Ontario band**, OAS-zone flag  
- Brackets from `buildYearPolicy(cpiIndex)` for that year (not a static 2026 table for all horizons)  
- Note: statutory bands only; surtax/clawback/phase-outs can raise effective rates  

### 11.5 Charts & household cash flow

- Real net-worth trajectory (deterministic ± MC fan when available)  
- Stacked withdrawals by account type (household)  
- Year-by-year household funding table (income streams + account draws + tax)  

### 11.6 Drawdown detail

- **One row per year**, **columns grouped by person**  
- **Withdrawals:** spend, each spouse (age, unreg, RRSP/RRIF, LIF, TFSA, top-up, total out), household tax  
- **Balances:** each spouse open total + end RRSP/LIRA/DC/LIF/TFSA/unreg/end total; household end  
- Opening balances = prior year-end (documented)  
- Links to **full-page** withdrawals and balances tables (browser scroll only)  
- Balance time-series chart by person  

### 11.7 Monte Carlo stress-test

- Success rate, estate percentiles, fan chart update  
- Labelled as stress-test / probability, not the only run mode  

---

## 12. Persistence

| Store | Content |
|-------|---------|
| `localStorage` scenarios | `{ schemaVersion, id, name, savedAt, seed, inputs }` — recompute results on load |
| `sessionStorage` last plan | Last analyzed inputs + names for full drawdown pages / refresh |

---

## 13. Policy constants (Gate 0)

All numeric policy in `constants-2026.ts` with source + `retrievedOn` + indexation flag (`cpi` | `frozen` | `wage`). Includes federal/Ontario tax, limits, CPP/OAS, RRIF factors, Ontario LIF max (FSRA table, age attained), validation anchors (e.g. top combined rates).  

Engine re-verification against CRA / Ontario / FSRA is an ongoing maintenance duty when tax year rolls.

---

## 14. Testing & quality bar

1. **Tax anchors** — external rates/credits/OHP bands; hand-computed profiles.  
2. **Schedules** — RRIF/LIF, TFSA room, PA.  
3. **Solver** — conservation, spending match.  
4. **Hand household** — multi-year zero-return checks.  
5. **MC** — zero-vol ≡ deterministic; seed reproducibility; performance budget.  
6. **Fuzz** — random households, invariants.  
7. **UI helpers** — analysis, validation, drawdown ledger, tax explain/brackets, scenario codec, engine-entry path.  
8. **Browser smoke** — auto-analyze, strategy vs naive, brackets, drawdown, full pages, scenario restore.  

`npm test` green is the gate for engine/helper changes.

---

## 15. UX / visual requirements

- Dark editorial theme; distinctive type and accent palette (not Bootstrap/Material banking grey).  
- Inputs panel must **not overflow into Results** (grid `minmax(0,…)`, inputs `width: 100%`, panel clip).  
- Plain-language labels + optional expert hints.  
- Persistent estimates-not-advice disclaimer.  
- Loading / busy states for analyze and MC.  

---

## 16. Roadmap (shipped vs still open)

### 16.1 Shipped since early v1 design (keep docs honest)

| Item | Notes |
|------|--------|
| First-death / survivorship (scoped) | Optional `survivorship` module; not full actuarial joint-life |
| Banded C + OAS soft-cap + person ceilings | Product `analyzePlan` path |
| TFSA L1–L4 + L4 share search | Default product level L4 |
| Housing, spend phases, one-time goals | Advanced plan options |
| GIS (rough), payroll (approx) | Optional; not full CRA tables |
| Web Worker | Long jobs off main thread with progress/cancel |
| Export | Print-friendly HTML + cashflow CSV |
| CPP×OAS start-age grid | Bounded expected-path search |
| Scenario compare, sensitivity, spend-to-zero | UI tools |
| GitHub Pages demo + CI | Open-source packaging |
| Longevity scenario grid | Deterministic both-live vs first-death at ages 75/85/95 (strategy pins held fixed) |

### 16.2 Still open (v2+)

| Item | Notes |
|------|--------|
| Stochastic life tables / insurance products | Deterministic longevity scenario grid (ages 75/85/95) is shipped; full actuarial joint-life remains open |
| Stock/ETF holdings + auto µ/σ | Account-level returns only today |
| Full CPP/OAS multi-objective optimizer | Grid exists; not MC-aware global search |
| Probate/EAT, RESP, FHSA, spousal RRSP, CPP assignment | |
| Non-eligible dividends, corporate accounts, US withholding | |
| AMT, full unused credit transfers, monthly steps | |
| True wage indexation of limits | CPI proxy in v1 for wage-flagged items |
| French UI, multi-user backend, branded PDF | HTML/CSV export exists |
| Global DP tax optimizer | Ceiling C heuristic remains product choice |

---

## 17. Explicit simplifications register

Annual steps; mid-year cash flows; same-year OAS clawback; annual (not quarterly) benefit indexation; TFSA smooth indexation; wage limits treated as CPI in v1; returns i.i.d. and independent of inflation; strategy tuned on expected path only (MC pins that policy); credits at lowest rate; no inter-spousal unused credit transfer; CPP/EI payroll optional approx only; GIS rough sketch; estate tax unsplit baseline; LIF max table held constant while reference rates keep the 6% floor binding; fees in returns; `taxableIncomePreSplit` used for bracket display (split optimizes tax but year row stores pre-split taxable field).

---

## 18. How to run

```bash
npm install
npm run dev      # http://localhost:5173/
npm test
npm run build
```

---

## 19. Success criteria (product)

The app succeeds for a review if a user can:

1. Open Horizon and immediately see a **funded sample path** with strategy vs naive.  
2. Edit lifestyle, spouses, savings, and strategy knobs with validation.  
3. Understand **where money comes from** (person × account) and **remaining balances** over time (including full-page tables).  
4. Understand **why** the tuned plan is preferred for tax/estate, with **future federal/Ontario bracket estimates**.  
5. Run a **Monte Carlo stress-test** with a clear success rate.  
6. **Save/load** a scenario without retyping everything.  
7. Always see that results are **estimates, not advice**.

---

*This document supersedes the 2026-07-18 draft gate plan as the product specification for Horizon v1. Implementation details live in code; when design and code diverge on intentional simplifications, the simplifications register (§17) and in-app copy win.*
