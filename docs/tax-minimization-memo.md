# Memorandum: How Horizon Approaches Lifetime Tax Across Accounts

**To:** Product stakeholders, users, and future maintainers  
**From:** Horizon engine design (as implemented)  
**Subject:** Lifetime, multi-account tax strategy — what the app optimizes, and what it does not  
**App version:** v1.4.x (behaviour stable since product analysis path)  
**Disclaimer:** Planning estimates under simplified federal + Ontario rules. Not tax, financial, or legal advice.

---

## 1. Executive summary

Horizon does **not** solve a formal multi-decade dynamic-programming “global tax minimum.” It runs a **practical, transparent heuristic** for a **two-person Ontario household**, comparing:

1. A **naive** decumulation path (no deliberate RRSP/RRIF meltdown), and  
2. A **tax-aware** path that may deliberately withdraw more from registered accounts earlier, park after-tax surplus in TFSA (and then unregistered), and order discretionary withdrawals to manage taxable income and OAS recovery.

The product objective used when searching strategy knobs is **lexicographic**:

1. **Maximize funded years** (never miss the lifestyle spend, when possible), then  
2. **Maximize real after-tax terminal estate**.

Tax reduction is therefore a **means and a reported outcome**, not the sole maximand. A plan that pays more living-year tax but leaves a larger after-tax estate (or funds more years) can beat a “lower lifetime tax” plan under this objective.

“Tax saved vs naive” is defined as:

\[
\Delta = \bigl(T^{\text{naive}}_{\text{living}} + T^{\text{naive}}_{\text{estate}}\bigr)
      - \bigl(T^{\text{tuned}}_{\text{living}} + T^{\text{tuned}}_{\text{estate}}\bigr)
\]

so **death tax on registered wealth is counted**, not only annual T1/ON428 totals.

---

## 2. The accounts and income streams in scope

For each spouse, the engine tracks (among others):

| Bucket | Role in tax story |
|--------|-------------------|
| **RRSP / RRIF** | Contributions deductible (accumulation); withdrawals taxable; RRIF minimums force income in old age |
| **LIRA / LIF** | Locked-in; taxable withdrawals; Ontario LIF maximums cap withdrawals |
| **DC pension** | Converts toward LIF-like treatment; taxable when drawn |
| **TFSA** | After-tax contributions; growth and withdrawals tax-free; room accrues |
| **Unregistered** | Interest, eligible dividends, capital gains (50% inclusion); ACB tracked |
| **Salary** | Taxable employment income while working |
| **CPP / OAS / DB** | Benefit income; OAS subject to recovery tax; DB eligible for pension credit / split rules |
| **Optional GIS / payroll** | GIS tax-free (sketch); payroll reduces cash only |

The household is simulated **year by year** from the plan start (full calendar years from January 1) through a horizon (default: younger spouse age 95), with CPI-indexed lifestyle spend and policy parameters.

---

## 3. What happens every year (order of tax-relevant operations)

Each simulated year roughly does the following. This sequence is the operational heart of “tax across accounts.”

### 3.1 Setup and forced flows

- Ages advance; **RRSP→RRIF** and **LIRA/DC→LIF** conversions apply by age rules.  
- **RRSP/TFSA room** accrues.  
- **Salary, CPP, OAS, DB** streams start when ages allow.  
- **RRIF/LIF minimums** (and LIF maximums) force registered withdrawals regardless of lifestyle need.  
- Unregistered **distributions** (interest / eligible dividends / gains) are recognized on opening balances.

### 3.2 Lifestyle funding (discretionary withdrawals)

When either spouse is retired, a **spending solver** finds gross withdrawals so that **after-tax cash** meets the household lifestyle target (phases, one-time goals, and survivor step-down if first death was modeled).

Within that solve:

- **Pension income splitting** is searched (grid over eligible pension income, both directions) to lower **household** tax for that year.  
- **Unused personal non-refundable credits** (simplified pool: BPA / age / pension-type credits at lowest rates) can be transferred between spouses after tax is computed.  
- **Discretionary withdrawal allocation** across accounts and spouses follows the active **TFSA policy level** (see §5) and prefers equalizing taxable income between spouses as a proxy for marginal-rate balance.

Default discretionary order under classic “legacy” thinking is roughly **unregistered → registered → LIF → TFSA**, but product levels **L1–L4** deliberately change when TFSA is used relative to a taxable-income ceiling **C**.

### 3.3 Meltdown top-ups (the core “tax-aware” lever)

After lifestyle is funded, the engine may withdraw **additional** RRSP/RRIF amounts so that taxable income approaches a **top-up ceiling C** (today’s dollars, CPI-scaled in each year). This is the **RRSP/RRIF meltdown** heuristic:

- **Purpose:** realize registered income in lower-bracket years; shrink the terminal registered “tax bomb” at death; create after-tax cash that can be **parked in TFSA** (room permitting).  
- **Naive baseline:** `C = 0` — no deliberate top-ups beyond mins and spending needs.  
- **Person ceilings:** household C can be split between spouses by registered balances (with floors), so the larger registered pile is not ignored.  
- **Top-up priority:** who fills under their ceiling first (default: higher registered balance).  
- **TFSA-aware meltdown:** top-ups may be **scaled** so estimated after-tax proceeds roughly fit remaining TFSA room (aggressive parking of meltdown surplus).  
- **OAS soft-cap:** effective ceiling can be limited to the year-scaled **OAS clawback threshold**, so the search does not deliberately push into recovery tax for the sake of a higher C.

After top-ups, **surplus** cash is allocated **TFSA room-first** (preferring the spouse with more room), then unregistered.

### 3.4 Growth and death

- Account growth uses a mid-year cash-flow convention.  
- Optional **first death** rolls assets to the survivor, steps down spend, and applies simplified CPP survivor boost.  
- At the **horizon**, estate tax is estimated by deeming remaining registered balances and unregistered gains as extra income in a simplified final-year calc (unsplit baseline). Ontario **estate administration tax** is reported as an upper-bound sketch and is **not** the strategy search objective.

---

## 4. How strategy knobs are chosen for a “full plan” run

When the user runs **Run full plan**, product analysis (`analyzePlan`) searches knobs on the **deterministic expected-return path** (not inside every Monte Carlo trial).

### 4.1 Search pipeline

1. **Prepare** household (clone, thorough tax solver, strip phantom DB accrual, default TFSA level **L4**).  
2. **Flat C grid** (coarse then fine): try top-up ceilings from 0 up to a max.  
3. **Age-banded C** (default ages ≤71 / ≤80 / ≤120 by older spouse): coordinate descent around the flat C so meltdown intensity can vary by life stage.  
4. **OAS soft-cap** applied on the tuned path (default on).  
5. **Person ceilings** from registered-balance split; **higherReg** top-up priority; **TFSA-aware meltdown** on.  
6. **L4 TFSA-first share** grid: what fraction of discretionary lifestyle withdrawals come from TFSA first (multi-year deterministic search).  
7. **Compare** to naive (`C = 0`) on living tax + estate tax and on real after-tax estate.

### 4.2 What “best” means again

A candidate loses if it **funds fewer years**. Among fully (or equally) funded paths, higher **real after-tax estate** wins. That is why the UI emphasizes both **tax saved vs naive** and **extra estate from strategy** — they are related but not identical stories (meltdown often **increases living tax** while reducing estate tax and improving net estate).

### 4.3 What is held fixed during search

- Lifestyle spend target (unless a separate tool like spend-to-zero re-grids C at each spend).  
- Account returns and inflation path for the deterministic run.  
- Monte Carlo later **pins** the chosen C, bands, OAS soft-cap, and L4 share; it does **not** re-optimize tax strategy under foresight each trial.

---

## 5. TFSA policy levels (how taxable vs tax-free withdrawals are ordered)

Product default is **L4**. Levels build on each other:

| Level | Behaviour |
|-------|-----------|
| **legacy** | TFSA last among discretionary sources |
| **L1** | Draw taxable sources up toward ceiling **C**, then TFSA, then taxable overflow |
| **L2** | Like L1, but income ceiling is **OAS-aware** (`min(C, OAS threshold)` when soft-cap logic applies) |
| **L3** | Like L2, plus try to preserve a **TFSA reserve** (N years of spending) unless needed to fund lifestyle |
| **L4** | Like L3, plus a searched **TFSA-first share** of discretionary withdrawals (multi-year tuned) |

Together with meltdown, this is how Horizon coordinates **registered (tax-deferred)**, **TFSA (tax-free)**, and **unregistered (taxable returns)** over the lifetime: force mins and benefits first, fund spending with a tax-aware mix, optionally melt registered into TFSA capacity, and avoid deliberate OAS clawback when soft-cap is on.

---

## 6. Lifetime arc: accumulation vs decumulation

### Accumulation (working years)

- Savings rules (fixed $ or % of salary) feed RRSP, TFSA, DC, unregistered with **overflow** chains (e.g. RRSP room full → TFSA → unregistered).  
- RRSP deductions reduce current tax; optional refund reinvestment can top up TFSA/unregistered.  
- Strategy search still runs on the full path, but **meltdown top-ups are a retirement-era lever**; working years are mainly about room, savings, and eventual registered balance size.

### Decumulation (retirement)

- Forced RRIF/LIF mins create taxable floors.  
- Lifestyle solver + pension split + credit transfer manage annual household tax.  
- Meltdown C / bands shape **when** registered income is recognized.  
- TFSA policy shapes **whether** spending comes from tax-free vs taxable accounts.  
- Terminal registered balances drive **estate tax** in the simplified death model — the main reason living-year tax alone is a bad scorecard.

### Survivorship / longevity tools

- Optional first death and the **longevity scenario grid** re-run the path under different death ages **with strategy pins held fixed**. They illustrate funding and estate under mortality assumptions; they are not a separate tax optimizer.

---

## 7. What is intentionally *not* optimized

Honest product boundaries matter for interpreting “tax minimization”:

| Not done | Implication |
|----------|-------------|
| Global multi-decade DP / stochastic DP | No proof of global optimum; heuristic vs naive |
| Per-trial MC re-tune of C | Stress test uses pinned policy; success rates are not “best response every path” |
| Full Schedule 2 line-by-line credits | Simplified unused personal-credit pool only |
| Perfect estate/probate planning | EAT is upper-bound sketch; beneficiary designations not modeled |
| Full GIS quarterly tables | Annual couple-aware sketch |
| Corporations, non-eligible dividends, multi-province | Out of scope |
| Pure minimize \(\sum\) tax | Would ignore shortfall risk and after-tax estate |

---

## 8. How a user should read the UI metrics

| Metric | Meaning in this framework |
|--------|---------------------------|
| **Tax-aware vs naive** | Same lifestyle and markets; differs mainly by meltdown C / bands / TFSA policy |
| **Lifetime tax (living)** | Sum of annual household tax on the path — often **higher** under meltdown |
| **Estate tax at death** | Simplified terminal tax on remaining registered + gains |
| **Tax saved vs naive** | Δ of (living + estate) tax — the fair comparison for meltdown |
| **Estate (real)** | After-tax terminal wealth in today’s purchasing power — primary co-objective with funding |
| **Monte Carlo success rate** | Share of noisy market paths that never miss spend **under pinned strategy** |

---

## 9. One-sentence model

Horizon’s lifetime, multi-account “tax strategy” is: **fund the lifestyle every year; use pension split and credit sharing within the year; deliberately realize registered income up to a searched, OAS-aware, person-aware ceiling when that improves funded years and real after-tax estate; park surplus in TFSA before unregistered; and score success against a no-meltdown baseline using living tax plus death tax — without claiming a global multi-decade optimum.**

---

## 10. Pointers in the codebase

| Concern | Primary location |
|---------|------------------|
| Year loop, top-ups, surplus, estate | `src/simulate.ts` |
| Federal/Ontario tax, split, credit transfer | `src/tax.ts` |
| Product strategy search | `src/lib/analysis.ts`, `tuneBandedC.ts`, `tfsaTune.ts`, `personPolicy.ts` |
| TFSA L1–L4 allocation | `src/lib/tfsaPolicy.ts` |
| Flat C grid (component of search) | `src/mc.ts` (`tuneStrategy`) |
| Naive vs tuned metrics / UI copy | `src/lib/taxExplain.ts`, results UI in `App.tsx` |

---

*End of memo.*
