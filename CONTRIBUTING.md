# Contributing to Horizon

Thanks for your interest in improving Horizon. This is a client-side Ontario couple retirement planner (Vite + React + TypeScript). Outputs are **planning estimates**, not financial, tax, or legal advice.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173/
npm test         # Vitest (required green before PR)
npm run build    # production build
```

Optional UI smoke (needs Playwright browsers installed once):

```bash
npx playwright install chromium
npm run smoke
```

## Project map

| Area | Location |
|------|----------|
| UI shell | `src/App.tsx`, `src/components/`, `src/styles/global.css` |
| Engine | `src/simulate.ts`, `src/tax.ts`, `src/mc.ts`, `src/policy.ts`, `src/constants-2026.ts` |
| Product analysis | `src/lib/analysis.ts`, `tuneBandedC.ts`, `tfsaPolicy.ts`, `personPolicy.ts` |
| Tests | `tests/*.test.ts`, `src/lib/*.test.ts` |
| Design / policy refresh | `retirement-planner-design.md`, `docs/ANNUAL-POLICY-REFRESH.md` |
| Lifetime tax strategy memo | `docs/tax-minimization-memo.md` |
| Agent/human codebase guides | `docs/codebase-guide.html`, `docs/codebase-guide.json` |

Prefer pure helpers under `src/lib/` for new analysis. Extend the year loop in `simulate.ts` only when state must live there.

## Development conventions

1. **Tests:** Drive real `simulate` / `analyzePlan` / `runMonteCarlo` when possible; avoid re-implementing engine logic in tests.
2. **Strategy object:** Always **merge** `household.strategy` fields — never replace with a single key (wipes TFSA level, bands, person ceilings).
3. **Objective:** Strategy search is lexicographic **funded years → real after-tax estate**, not pure tax min.
4. **Policy numbers:** Update `src/constants-2026.ts` with sources + `retrievedOn`, and note the change in `docs/ANNUAL-POLICY-REFRESH.md`.
5. **Phantom DB:** Zero DB entitlement must clear the whole `db` object (`stripPhantomDb`).
6. **Workers:** Payloads must be structured-cloneable (no functions in `postMessage`).

## Pull requests

1. Branch from `main`.
2. Keep the change focused; prefer small PRs.
3. Ensure `npm test` and `npm run build` pass locally.
4. Describe **what** changed and **why** (user-visible behaviour or engine fidelity).
5. Mention any intentional tax/model simplifications.

CI runs tests and a production build on every PR and push to `main`. The live demo deploys from `main` via GitHub Pages.

## Reporting issues

Please include:

- What you expected vs what happened  
- Browser (for UI) or Node version (for engine)  
- Whether you used the sample couple or custom inputs  
- Approximate ages / balances if relevant (no need for real personal data)

## License

By contributing, you agree that your contributions are licensed under the same [MIT License](LICENSE) as the project.

## Security & privacy

Horizon runs entirely in the browser. Do not open PRs that send household inputs to a backend without a clear, documented product decision. Report security concerns via GitHub issues (or a private security advisory if the repo enables them).
