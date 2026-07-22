# Horizon — Annual tax & regulation refresh plan

**Purpose:** Checklist and data inventory for updating Horizon when a new **tax year** (or material mid-year law change) arrives.  
**Primary code home:** `src/constants-YYYY.ts` (currently `constants-2026.ts`) + `policy.ts` + tests that pin numeric anchors.  
**Related product design:** `retirement-planner-design.md` §13, §17.

**Cadence**

| When | Action |
|------|--------|
| **Annual (required)** | Full refresh after CRA / Ontario publish the new tax year (typically late fall–early calendar year). |
| **Ad hoc** | Mid-year bills that change rates, inclusion, credits, or benefit formulas used by this app. |
| **Not required** | Daily market noise; modelling defaults (vol, ρ) unless you choose to retune. |

**Definition of done for a refresh**

1. Every row in §3–§9 below has a value, source URL/title, and `retrievedOn` date.  
2. `RETRIEVED` (or equivalent) updated; indexation flags re-confirmed.  
3. `VALIDATION_ANCHORS` recomputed/cross-checked and unit tests updated.  
4. `npm test` green; hand-spot-check 1–2 tax profiles if anchors moved a lot.  
5. README / UI copy that mentions “YYYY baseline” updated if the base year changed.  
6. This file’s **Refresh log** (§12) gets a new entry.

---

## 1. Process overview

```text
1. Open a tax-year branch / worktree
2. Gather primary sources (CRA, Ontario MoF / T4032ON, ESDC, FSRA)
3. Fill checklist tables (this doc) — do not edit from memory
4. Patch constants module (rename file if base year changes: constants-2027.ts)
5. Update imports: policy.ts, tests, any hard-coded year labels
6. Update VALIDATION_ANCHORS + tax.test.ts / simulate fixtures as needed
7. npm test  (+ optional UI smoke)
8. Log completion in §12
```

### 1.1 If the base tax year changes (e.g. 2026 → 2027)

| Task | Notes |
|------|--------|
| Rename / add `constants-2027.ts` | Keep `Sourced<T>` pattern |
| Point `policy.ts` imports at new module | |
| Projection base: `buildYearPolicy(1)` = new tax year | CPI path is relative to that base |
| `defaultStartYear()` | Unchanged logic (next Jan 1); no hard-coded 2026 required |
| Sample household / demos | Uses `defaultStartYear()` already |
| Copy: “2026 baseline” in UI/disclaimer | Search repo for year strings |

### 1.2 Mid-year law change (same base year)

Update only affected constants + anchors + tests. Bump `retrievedOn` and notes. Do not wait for the next January if material (e.g. rate cut, capital gains inclusion).

---

## 2. Primary source catalogue

Bookmark and re-open each refresh. Prefer **government** over secondary (KPMG/EY/TaxTips = corroboration only).

| ID | Authority | What to use it for |
|----|-----------|-------------------|
| **CRA-IDX** | canada.ca — Indexation adjustment for personal income tax and benefit amounts | Federal thresholds, BPA, age amount, OAS clawback threshold, TFSA formula notes |
| **CRA-LIM** | canada.ca — MP, DB, RRSP, DPSP, ALDA, TFSA limits; YMPE/YAMPE | RRSP dollar limit, MP limit, DB limit, YMPE, YAMPE |
| **T4032ON** | CRA Payroll Deductions Tables — Ontario (January of tax year) | ON brackets, surtax, BPA, OHP, tax reduction basic, credit rate |
| **TD1ON** | CRA Form TD1ON (tax year) | ON age amount, age threshold, pension amount |
| **ESDC / OAS** | canada.ca — OAS amounts (quarterly); recovery tax notes | OAS monthly max 65–74 / 75+, clawback rate |
| **CPP-AMT** | canada.ca — CPP monthly payment amounts | Max at 65, average new benefit (optional UI default) |
| **FIN / Budget** | Dept. of Finance / legislation (e.g. lowest rate, credit rate) | Federal rates, credit conversion rate, temporary credits |
| **FSRA LIF** | FSRA PE0196INF (or successor) — LIF/LRIF maximum annual income table | Ontario LIF max factors by age attained |
| **RRIF** | CRA prescribed factors chart | RRIF minimum factors 71+; confirm no temporary changes |
| **Secondary** | KPMG/EY/PwC/TaxTips combined-rate tables | Cross-check top marginal rates and age-credit nil points only |

Record for each pull: **URL, title, effective tax year, retrieval ISO date.**

---

## 3. Federal income tax — required data

**Code:** `FEDERAL` in constants module.  
**Indexation:** thresholds/amounts usually `cpi`; **rates** `frozen` unless statute changes.

| Field (code) | Description | Indexed? | Source | New value | Retrieved | Notes / done |
|--------------|-------------|----------|--------|-----------|-----------|--------------|
| `brackets[]` | `{ from, rate }` for each federal band | from: cpi; rate: frozen | CRA-IDX + FIN | | | Confirm lowest rate (e.g. 14%) and all thresholds |
| `creditRate` | Non-refundable credit conversion rate | frozen | FIN | | | Track lowest bracket rate; Top-Up Tax Credit material? |
| `bpa.max` | BPA max (with enhancement) | cpi | CRA-IDX | | | |
| `bpa.base` | BPA after full phase-out | cpi | CRA-IDX | | | |
| `bpa.enhancement` | max − base (or publish if separate) | cpi | CRA-IDX | | | Must equal max − base |
| `bpa.phaseOutStart` | Start of BPA enhancement phase-out | cpi | CRA-IDX | | | Often = 29% threshold |
| `bpa.phaseOutEnd` | End of phase-out | cpi | CRA-IDX | | | Often = 33% threshold |
| `ageAmount` | Federal age amount (65+) | cpi | CRA-IDX | | | |
| `ageAmountThreshold` | Phase-out start for age amount | cpi | CRA-IDX | | | |
| `ageAmountPhaseOutRate` | Usually 15% | frozen | CRA / secondary | | | |
| `pensionIncomeAmount` | Federal pension income amount | frozen | ITA s.118(3) | | | Long frozen at $2,000 — confirm still true |
| `eligibleDividend.grossUp` | e.g. 38% | frozen | CRA / secondary | | | Rarely changes |
| `eligibleDividend.dtcOnGrossedUp` | Federal DTC rate on grossed-up | frozen | CRA / secondary | | | |
| `capitalGainsInclusion` | e.g. 0.5 | frozen | FIN / statute | | | Watch budget changes |
| `oasClawback.threshold` | Net income start of OAS recovery | cpi | CRA-IDX | | | Income year N |
| `oasClawback.rate` | Usually 15% | frozen | ESDC | | | |

**Engine behaviour after update:** `policy.ts` multiplies `cpi`-flagged federal `from` thresholds by cumulative CPI from the **base tax year**. Rates stay as entered.

---

## 4. Ontario income tax — required data

**Code:** `ONTARIO`.

| Field (code) | Description | Indexed? | Source | New value | Retrieved | Notes / done |
|--------------|-------------|----------|--------|-----------|-----------|--------------|
| `brackets[]` | ON rates and thresholds | mixed | T4032ON / MoF | | | **Confirm which thresholds are frozen** (historically $150k / $220k) |
| `creditRate` | Lowest ON rate (e.g. 5.05%) | frozen | T4032ON | | | |
| `surtax.tier1Threshold` | ON surtax tier 1 on basic tax | cpi | T4032ON | | | |
| `surtax.tier1Rate` | e.g. 20% | frozen | T4032ON | | | |
| `surtax.tier2Threshold` | Tier 2 | cpi | T4032ON | | | |
| `surtax.tier2Rate` | e.g. 36% | frozen | T4032ON | | | |
| `healthPremium` | OHP band table (over, cap, rate, base) | frozen | T4032ON | | | Confirm still frozen; max still $900 |
| `bpa` | Ontario BPA | cpi | T4032ON | | | |
| `ageAmount` | ON age amount | cpi | TD1ON | | | |
| `ageAmountThreshold` | ON age phase-out start | cpi | TD1ON | | | |
| `ageAmountPhaseOutRate` | Usually 15% | frozen | secondary | | | |
| `pensionIncomeAmount` | ON pension amount | cpi | TD1ON | | | |
| `eligibleDividendDtcOnGrossedUp` | ON DTC on grossed-up | frozen | secondary | | | |
| `taxReductionBasic` | Ontario tax reduction basic amount | cpi | T4032ON + EY | | | |

**Critical:** In `policy.ts`, only **indexed** ON bracket thresholds should move with CPI. Re-read the statutory freeze list every year and keep the map in `buildYearPolicy` correct.

---

## 5. Registered plan limits & PA — required data

**Code:** `LIMITS`.

| Field (code) | Description | Indexed? | Source | New value | Retrieved | Notes / done |
|--------------|-------------|----------|--------|-----------|-----------|--------------|
| `rrspDollarLimit` | Annual RRSP dollar limit | wage→cpi in v1 | CRA-LIM | | | Note announced future years if useful |
| `rrspEarnedIncomeRate` | 18% | frozen | CRA | | | |
| `moneyPurchaseLimit` | MP limit (DC PA cap) | wage→cpi | CRA-LIM | | | |
| `dbLimit` | Max DB unit (MP/9) | wage→cpi | CRA-LIM | | | |
| `tfsaAnnualLimit` | TFSA dollar limit | cpi (smooth in v1) | CRA-IDX | | | Law uses $500 steps; v1 smooths |
| `ympe` | Year’s maximum pensionable earnings | wage→cpi | CRA-LIM | | | |
| `yampe` | Year’s additional maximum (CPP2) | wage→cpi | CRA-LIM | | | |
| `paDbFormula` | PA = 9×accrual − 600 | frozen | T4084 | | | Confirm $600 offset still |
| `paDcFormula` | PA = EE+ER DC | frozen | T4084 | | | |

---

## 6. CPP — required data

**Code:** `CPP`.  
**Note:** User’s Service Canada estimate is still the primary benefit input; these are UI defaults / factors.

| Field (code) | Description | Indexed? | Source | New value | Retrieved | Notes / done |
|--------------|-------------|----------|--------|-----------|-----------|--------------|
| `maxMonthlyAt65` | Max new CPP at 65 (monthly) | cpi in sim | CPP-AMT | | | Annualize ×12 in policy |
| `averageNewMonthlyAt65` | Optional UI default | cpi | CPP-AMT | | | |
| `earlyFactorPerMonth` | −0.6%/mo before 65 | frozen | canada.ca | | | Confirm unchanged |
| `deferralFactorPerMonth` | +0.7%/mo after 65 | frozen | canada.ca | | | |
| `startAgeRange` | 60–70 | frozen | canada.ca | | | |
| Indexation rule | Annual Jan CPI (modelled annually) | — | canada.ca | | | Document only |

---

## 7. OAS — required data

**Code:** `OAS` + federal clawback above.

| Field (code) | Description | Indexed? | Source | New value | Retrieved | Notes / done |
|--------------|-------------|----------|--------|-----------|-----------|--------------|
| `maxMonthly65to74` | Full OAS 65–74 (pick a quarter; document which) | cpi | ESDC | | | v1 annualizes; note quarter used |
| `maxMonthly75plus` | Full OAS 75+ | cpi | ESDC | | | |
| `age75Boost` | 10% if modelled as factor | frozen | canada.ca | | | Or bake into 75+ amount |
| `deferralFactorPerMonth` | +0.6%/mo to 70 | frozen | ESDC | | | |
| `startAgeRange` | 65–70 | frozen | canada.ca | | | |
| `fullResidenceYears` | 40 | frozen | canada.ca | | | |
| Clawback | See FEDERAL.oasClawback | | | | | |

---

## 8. RRIF minimums — required data

**Code:** `RRIF_MIN_FACTOR`, `rrifMinFactor()`.

| Item | Description | Source | Action | Done |
|------|-------------|--------|--------|------|
| Factors ages 71–94 | Prescribed % of Jan 1 FMV | CRA chart | Diff against current table; update if changed | |
| Under 71 | `1/(90 − age)` | CRA | Confirm still applies | |
| Age 95+ | 20% | CRA | Confirm | |
| Temporary measures | One-year reductions etc. | CRA / Finance | Apply only for that tax year if enacted | |
| Younger-spouse election | Age keying | CRA | Behaviour unchanged unless law changes | |

---

## 9. Ontario LIF maximums — required data

**Code:** `ONTARIO_LIF_MAX_FACTOR`, `ontarioLifMaxFactor()`.

| Item | Description | Source | Action | Done |
|------|-------------|--------|--------|------|
| Max factors by age attained | Schedule 1.1 table | **FSRA primary** (not only aggregator sites) | Replace table if published factors change | |
| Keying | Age attained during fiscal year | FSRA PE0196INF | Confirm still | |
| Prior-year earnings rule | max(factor×Jan1, prior investment return) | Reg. 909 | Code already; re-read if regulation amends | |
| 6% floor / CANSIM | Table constant while long bond &lt; 6% | FSRA | Note current reference rate; if &gt; 6%, table may change | |
| 50% unlock | One-time unlock at LIF purchase | FSRA / ON | Confirm parameters still 50% / 60 days | |

---

## 10. Validation anchors — recompute every refresh

**Code:** `VALIDATION_ANCHORS` + `tests/tax.test.ts`.

These are **not** free parameters; derive from the new constants and external combined-rate tables.

| Anchor | How to get it | Used for |
|--------|---------------|----------|
| `topCombinedMarginalRegular` | Top fed rate + ON top rate × (1 + full surtax factor) | marginalRate test |
| `topCombinedMarginalCapitalGains` | ≈ half of regular at 50% inclusion | marginalRate test |
| `topCombinedMarginalEligibleDividend` | Worked marginal with gross-up + DTCs + ON surtax order | Dividend / surtax-before-DTC |
| `fedAgeCreditMax` | ageAmount × creditRate | Age credit |
| `fedAgeCreditNilAtNetIncome` | Where age amount phases to zero | Age credit |
| `onAgeCreditMax` | ON ageAmount × ON creditRate | Age credit |
| `onAgeCreditNilAtNetIncome` | ON age phase-out end | Age credit |
| `onTaxReductionZeroTaxUpTo` | TI where ON tax reduction zeros basic tax (ex-OHP) | ON reduction |
| `onTaxReductionClawbackEnd` | Where reduction fully gone | ON reduction |

Also re-hand-compute **at least one** low-income worker and one senior profile in `tax.test.ts` if brackets moved materially.

---

## 11. Non-policy / product checks (optional each year)

| Item | Location | Refresh? |
|------|----------|----------|
| Default inflation 2.1% | `ECON_DEFAULTS` | Optional (modelling) |
| MC default vol / correlation | `ECON_DEFAULTS` / UI | Optional |
| `defaultStartYear()` | `src/lib/defaultStartYear.ts` | Logic stable; no annual change |
| Sample couple balances | `sampleHousehold.ts` | Optional demo realism |
| Disclaimer tax-year string | `App.tsx` / README | **Yes** if base year changes |
| Design doc §13 year labels | `retirement-planner-design.md` | Yes when base year changes |

---

## 12. Engineering checklist (after numbers)

- [ ] Constants file updated; all `src()` entries have sources + `retrievedOn`  
- [ ] `policy.ts` freeze map for ON brackets still correct  
- [ ] No leftover imports of old `constants-20XX`  
- [ ] `VALIDATION_ANCHORS` + tax unit tests updated  
- [ ] Simulate / schedule tests still pass (RRIF, LIF factors)  
- [ ] `npm test` green  
- [ ] Optional: `npm run dev` + smoke (sample analyze still funded, brackets table renders)  
- [ ] Commit message: `policy: refresh YYYY tax constants`  
- [ ] Log row below  

### Refresh log

| Tax year base | Completed (ISO) | Operator | Notes |
|---------------|-----------------|----------|-------|
| 2026 | 2026-07-19 | (initial Gate 0) | Pinned in `constants-2026.ts` |
| | | | |

---

## 13. Blank working sheet (copy per refresh)

**Target base tax year:** ________  
**Operator:** ________  
**Start date:** ________  
**Complete date:** ________  

### Sources pulled

| ID | URL | Page date / effective | Retrieved |
|----|-----|----------------------|-----------|
| CRA-IDX | | | |
| CRA-LIM | | | |
| T4032ON | | | |
| TD1ON | | | |
| CPP-AMT | | | |
| ESDC OAS | | | |
| FIN / Budget | | | |
| FSRA LIF | | | |
| RRIF chart | | | |
| Secondary (list) | | | |

### Material law changes this year (free text)

-  
-  

### Post-refresh verification

| Check | Pass? |
|-------|-------|
| `npm test` | |
| Top combined regular rate matches secondary table | |
| LIF factors vs FSRA PDF/HTML | |
| RRIF 71 / 95 factors spot-check | |
| UI disclaimer year string | |

---

## 14. What this refresh deliberately does *not* include

- Rewriting the tax engine structure  
- Survivor / first-death modelling  
- Monthly or mid-year partial first year (still full Jan 1 years; `defaultStartYear` already prefers next year mid-year)  
- Automatic download from CRA APIs (manual sourced constants by design)  
- Stock/ETF market-data feeds  

---

*Use this document as the single checklist for annual Horizon policy updates. Implementation detail remains in `src/constants-*.ts` and `policy.ts`.*
