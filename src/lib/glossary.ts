/** Plain-language terms used across Horizon UI (A10). */

export type GlossaryKey =
  | "hhTax"
  | "meltdown"
  | "topUpCeiling"
  | "oasZone"
  | "livingTax"
  | "totalTaxSaved"
  | "estateReal"
  | "nominal"
  | "real"
  | "successRate"
  | "naive"
  | "spendToZero"
  | "estateTax"
  | "longevity";

export interface GlossaryEntry {
  term: string;
  short: string;
  detail?: string;
}

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  hhTax: {
    term: "HH tax",
    short: "Household tax for that year — both spouses combined (federal + Ontario as modeled).",
    detail: "Not tax on withdrawals only; includes salaries, pensions, OAS clawback, RRIF, capital gains, etc.",
  },
  meltdown: {
    term: "Meltdown",
    short: "Deliberately withdrawing extra from RRSP/RRIF while alive to reduce the tax bomb at death.",
    detail: "After funding spending, top-ups fill taxable income toward a ceiling; surplus can go to TFSA/non-registered.",
  },
  topUpCeiling: {
    term: "Top-up ceiling (C)",
    short: "Taxable-income cap (today’s $) the plan may fill with extra RRSP/RRIF withdrawals each year.",
    detail:
      "Full plan searches a flat C, then age bands (≤71 / ≤80 / later). OAS soft-cap keeps meltdown under the clawback threshold. 0 = no deliberate meltdown (naive).",
  },
  oasZone: {
    term: "OAS zone",
    short: "Income high enough that OAS may be partly clawed back (recovery tax).",
    detail: "Statutory bands in the bracket table are approximate; clawback can raise effective rates.",
  },
  livingTax: {
    term: "Lifetime tax (living)",
    short: "Sum of taxes paid during life on the path — not including final estate tax on death.",
  },
  totalTaxSaved: {
    term: "Tax saved vs naive",
    short: "Living tax + estate tax on naive path, minus the same on the tax-aware path.",
    detail: "Do not add this to extra estate — death-tax savings are already inside after-tax estate.",
  },
  estateReal: {
    term: "Estate (real)",
    short: "After-tax wealth left at the end of the plan, in today’s purchasing power (÷ CPI).",
  },
  nominal: {
    term: "Nominal",
    short: "Dollars of that calendar year — not adjusted for inflation.",
    detail: "Later years often look larger even when real lifestyle is flat.",
  },
  real: {
    term: "Real (today’s $)",
    short: "Inflation-adjusted to the plan’s start purchasing power.",
  },
  successRate: {
    term: "Funding / success rate",
    short: "Share of Monte Carlo trials that never miss the spending target.",
  },
  naive: {
    term: "Naive baseline",
    short: "Same plan with no deliberate RRIF meltdown (top-up ceiling C = 0).",
  },
  spendToZero: {
    term: "Spend-to-zero",
    short: "Highest lifestyle spend that still funds every year, aiming for little leftover estate.",
  },
  estateTax: {
    term: "Estate tax at death",
    short: "Extra tax from deeming registered accounts and unregistered gains at the end of the plan.",
    detail:
      "Shown in year-of (nominal) dollars. After-tax estate (real) already subtracts this. Model uses a simplified unsplit final-year baseline.",
  },
  longevity: {
    term: "Longevity scenarios",
    short: "Side-by-side expected paths if both live to the horizon vs one spouse dies first at chosen ages.",
    detail:
      "Uses your current tax-strategy pins; survivor spend can step down. Not a stochastic life table or insurance product.",
  },
};

export function glossaryTitle(key: GlossaryKey): string {
  const e = GLOSSARY[key];
  return e.detail ? `${e.short}\n\n${e.detail}` : e.short;
}
