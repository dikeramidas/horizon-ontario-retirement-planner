# Changelog

All notable changes to Horizon are documented here.
Format inspired by [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [1.4.0] — 2026-07-22

### Added
- First-run **onboarding tour** (skippable; replay via **Tour**).
- **Demo banner** on GitHub Pages (`vX.Y.Z · estimates, not advice`).
- Mobile sticky **Run full plan / Stress test** bar and responsive layout polish.
- Branded **Print / PDF** summary HTML (masthead, version, stronger disclaimer).
- Demo preview image (`docs/demo-preview.svg`) for README.
- GitHub topics for discoverability.

### Changed
- App version surface (`APP_RELEASE_LABEL`) in header/footer/export.
- Changelog compare links use real git tags.

## [1.3.0] — 2026-07-22

### Added
- GitHub issue templates (bug report, feature request) and this changelog.
- **Spousal unused personal-credit transfer** (simplified BPA/age/pension pool) on household tax.
- **Ontario Estate Administration Tax sketch** on simulation results (upper-bound; not deducted from estate objective).
- **Couple-aware GIS estimate** (single vs partner max + combined-income reduction).

### Changed
- Hand-check simulate fixtures updated for credit-transfer semantics; RRSP refund uses pre-transfer individual tax.

## [1.2.0] — 2026-07-22

### Added
- **Longevity scenarios** — compare both-live vs first death at ages 75/85/95 (strategy pins held fixed); apply death year to household plan.
- `src/lib/longevityScenarios.ts`, `LongevityPanel` UI, glossary term.

## [1.1.0] — 2026-07-22

### Added
- GitHub Actions **CI** (`npm test` + build) and **GitHub Pages** demo deploy.
- `CONTRIBUTING.md`, MIT license, public open-source packaging.
- Design doc roadmap sync (shipped vs open).

### Fixed
- MC performance assertion uses a looser bound under `CI=true` (runner noise).

## [1.0.0] — 2026-07-22

### Added
- Initial public release: Ontario couple retirement SPA (Vite/React/TS).
- Federal + Ontario tax engine, simulate path, Monte Carlo, banded C strategy, TFSA L1–L4, person policy.
- Scenarios, export, drawdown tables, spend-to-zero, sensitivity, survivorship (scoped), housing and other optional modules.

[Unreleased]: https://github.com/dikeramidas/horizon-ontario-retirement-planner/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/dikeramidas/horizon-ontario-retirement-planner/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dikeramidas/horizon-ontario-retirement-planner/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dikeramidas/horizon-ontario-retirement-planner/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dikeramidas/horizon-ontario-retirement-planner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dikeramidas/horizon-ontario-retirement-planner/releases/tag/v1.0.0
