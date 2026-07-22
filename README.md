# Horizon — Ontario Couple Retirement Planner

[![CI](https://github.com/dikeramidas/horizon-ontario-retirement-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/dikeramidas/horizon-ontario-retirement-planner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A full-lifecycle retirement simulator for a two-person Ontario household:
line-by-line 2026 federal + Ontario tax (surtax, OHP, credits, OAS clawback),
CPP/OAS timing, RRIF minimums, FSRA LIF maximums, pension-income-split
optimization, RRSP/RRIF meltdown strategy, and seeded Monte Carlo.

**Estimates, not advice.** All calculation runs in your browser; household data stays on your device.

## Live demo

**https://dikeramidas.github.io/horizon-ontario-retirement-planner/**

(Deployed from `main` via GitHub Pages. First load analyzes a sample couple automatically.)

## License

This project is open source under the [MIT License](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) if you’d like to help, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## Run the app locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (default [http://localhost:5173/](http://localhost:5173/)).

On first open the sample couple is **analyzed automatically** (lifetime path + tax strategy vs naive). Use **Run full plan** after edits; **Market stress test** runs Monte Carlo. After a full plan, **Longevity scenarios** compare both-live vs first death at ages 75/85/95.

Simulation years are full calendar years from **January 1**. If you open the app mid-year, the default start year is **next** January 1.

## Run the tests

```bash
npm test
```

Expect the full suite green (tax anchors, hand-computed household years, FSRA LIF
caps, Monte Carlo equivalences, UI→engine path, formatters, scenario codec).

CI runs the same `npm test` + `npm run build` on every push and pull request to `main`.

## Files

### App (UI)

- `index.html`, `src/main.tsx` — Vite entry
- `src/App.tsx` — Horizon React UI (inputs, deterministic + Monte Carlo results, scenarios)
- `src/styles/global.css` — distinctive visual system
- `src/components/*` — charts and cash-flow table
- `src/lib/*` — sample household, formatters, scenario persistence, cash-flow mappers

### Engine

- `src/constants-2026.ts` — every policy constant, pinned with sources
- `src/policy.ts` — CPI-scaled `YearPolicy`
- `src/tax.ts` — T1/ON428 engine and household split optimizer
- `src/simulate.ts` — deterministic lifetime simulator and spending solver
- `src/mc.ts` — seeded Monte Carlo and strategy tuner
- `src/engine-entry.ts` — public engine surface

### Tests & design

- `tests/*.test.ts` — engine unit and property tests
- `src/lib/*.test.ts` — UI helpers and engine-entry smoke
- `retirement-planner-design.md` — product design document
- `docs/ANNUAL-POLICY-REFRESH.md` — yearly tax/regulation refresh checklist
- `docs/codebase-guide.html` / `docs/codebase-guide.json` — human + agent codebase maps
- `.github/workflows/` — CI and GitHub Pages deploy

## Known approximations (by design, documented in code)

- Estate tax baseline uses each spouse's final-year unsplit income, slightly
  understating estate tax.
- The pension-split search is a fine grid with a cadence, near-optimal rather
  than provably optimal; Monte Carlo trials use a faster solver mode bounded
  by test to within 0.5% of the thorough mode's lifetime tax.
- Volatility (11%) and correlation (0.85) defaults are editable modelling
  choices, not sourced policy.
