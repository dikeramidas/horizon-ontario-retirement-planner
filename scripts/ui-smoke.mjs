/**
 * Headless UI smoke against a running Vite dev server.
 * Expects auto-analyze on first load (review-ready path).
 * Usage: SCRATCH=... node scripts/ui-smoke.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SCRATCH = process.env.SCRATCH || path.resolve("scratch-ui");
fs.mkdirSync(SCRATCH, { recursive: true });
const url = process.env.APP_URL || "http://127.0.0.1:5173/";
const log = [];
const push = (m) => {
  log.push(m);
  console.log(m);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const t = msg.text();
  if (/ERR_CONNECTION_RESET|ERR_ABORTED|favicon|net::ERR_/i.test(t)) return;
  errors.push("console:" + t);
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
push("title=" + (await page.title()));
// Dismiss first-run tour if present (does not block auto-analyze, but can cover UI)
const onboard = page.getByTestId("onboarding-wizard");
if (await onboard.count().then((n) => n > 0).catch(() => false)) {
  const skip = page.getByTestId("onboard-skip");
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    push("onboarding_skipped=1");
  }
}
const h1 = await page.locator("h1").first().innerText();
push("h1=" + h1);
const disclaimer = await page.getByTestId("disclaimer").innerText();
push("disclaimer_has_estimates=" + /estimates/i.test(disclaimer));
await page.getByTestId("inputs-panel").waitFor();
await page.getByTestId("run-analyze").waitFor();

// First load should auto-analyze — wait for metrics without requiring three buttons
await page.getByTestId("hero-metrics").waitFor({ timeout: 180000 });
// strategy compare should be present with naive numbers
await page.getByTestId("strategy-compare").waitFor({ timeout: 10000 });
await page.getByTestId("naive-tax").waitFor({ timeout: 10000 });

const success = await page.getByTestId("success-rate").innerText();
const estate = await page.getByTestId("estate-real").innerText();
const tax = await page.getByTestId("lifetime-tax").innerText();
const naiveTax = await page.getByTestId("naive-tax").innerText();
const taxSaving = await page.getByTestId("tax-saving").innerText();
push("success_rate=" + success);
push("estate=" + estate);
push("tax=" + tax);
push("naive_tax=" + naiveTax);
push("tax_saving=" + taxSaving);

// Tax minimization explanation + future brackets
await page.getByTestId("tax-strategy-explain").waitFor({ timeout: 10000 });
const whyTax = await page.getByTestId("why-tax-saving").innerText();
const whyNaive = await page.getByTestId("why-naive-tax").innerText();
const whyTuned = await page.getByTestId("why-tuned-tax").innerText();
const reasonsText = await page.getByTestId("tax-why-reasons").innerText();
push("why_tax_saving=" + whyTax);
push("why_naive_tax=" + whyNaive);
push("why_tuned_tax=" + whyTuned);
push("why_has_reasons=" + (reasonsText.length > 40));
if (!whyTax || whyTax === "—") throw new Error("missing tax-saving in why panel");
if (!/ceiling|RRSP|tax|estate|OAS|bracket/i.test(reasonsText)) {
  throw new Error("why reasons look empty/generic");
}
await page.getByTestId("future-brackets").waitFor();
const brText = await page.getByTestId("future-brackets").innerText();
push("brackets_has_alex=" + /Alex/i.test(brText));
push("brackets_has_jordan=" + /Jordan/i.test(brText));
push("brackets_has_bands=" + /% band|Federal band|Taxable income/i.test(brText));
const aRows = await page.locator('[data-testid="brackets-person-a"] tbody tr').count();
const bRows = await page.locator('[data-testid="brackets-person-b"] tbody tr').count();
push("bracket_year_rows_a=" + aRows);
push("bracket_year_rows_b=" + bRows);
if (aRows < 4 || bRows < 4) throw new Error("expected multi-year bracket rows per person");
if (aRows !== bRows) throw new Error("person bracket tables should have same year count");
// Headers must match body column count (no sticky multi-row misalignment)
const aHead = await page.locator('[data-testid="brackets-person-a"] thead th').count();
const aCell = await page.locator('[data-testid="brackets-person-a"] tbody tr').first().locator("td").count();
push("bracket_cols_head=" + aHead + " body=" + aCell);
if (aHead !== aCell) throw new Error(`bracket header/body column mismatch: ${aHead} vs ${aCell}`);
await page.screenshot({ path: path.join(SCRATCH, "tax-explain-ui.png"), fullPage: true });
push("screenshot_tax_explain=tax-explain-ui.png");

const table = await page.getByTestId("cashflow-table").isVisible();
const wchart = await page.getByTestId("withdrawal-chart").isVisible();
const fan = await page.getByTestId("fan-chart").isVisible();
push("cashflow_table=" + table);
push("withdrawal_chart=" + wchart);
push("fan_chart=" + fan);

// Drawdown detail + full-page links
await page.getByTestId("drawdown-detail").waitFor({ timeout: 10000 });
await page.getByTestId("drawdown-person-table").waitFor();
const ddText = await page.getByTestId("drawdown-detail").innerText();
push("drawdown_has_alex=" + /Alex/i.test(ddText));
push("drawdown_has_jordan=" + /Jordan/i.test(ddText));
push("drawdown_has_accounts=" + /RRSP|LIF|TFSA|Top-up/i.test(ddText));
const personRows = await page.locator('[data-testid="drawdown-person-table"] tbody tr').count();
push("drawdown_year_rows=" + personRows);
if (personRows < 4) throw new Error("expected multi-year rows (one per year)");
const headText = await page.locator('[data-testid="drawdown-person-table"] thead').innerText();
push("drawdown_header_both_persons=" + (/Alex/i.test(headText) && /Jordan/i.test(headText)));
if (!/Alex/i.test(headText) || !/Jordan/i.test(headText)) {
  throw new Error("drawdown header should group columns by both person names");
}

// Full withdrawals page (no nested scroll box)
await page.getByTestId("link-full-withdrawals").click();
await page.getByTestId("drawdown-full-page").waitFor({ timeout: 30000 });
const fullMode = await page.getByTestId("drawdown-full-page").getAttribute("data-mode");
push("full_page_mode=" + fullMode);
if (fullMode !== "withdrawals") throw new Error("expected withdrawals full page");
const fullHasScrollClass = await page.locator(".table-scroll-full").count();
push("full_page_unbounded_table=" + (fullHasScrollClass > 0));
const fullRows = await page.locator('[data-testid="drawdown-person-table"] tbody tr').count();
push("full_withdrawals_rows=" + fullRows);
if (fullRows < 4) throw new Error("full withdrawals table empty");
await page.screenshot({ path: path.join(SCRATCH, "drawdown-full-withdrawals.png"), fullPage: true });

// Full balances page
await page.getByTestId("link-switch-drawdown").click();
await page.waitForFunction(
  () => document.querySelector('[data-testid="drawdown-full-page"]')?.getAttribute("data-mode") === "balances",
  null,
  { timeout: 10000 }
);
await page.getByTestId("balance-ledger-table").waitFor();
const balRows = await page.locator('[data-testid="balance-ledger-table"] tbody tr').count();
push("full_balance_rows=" + balRows);
if (balRows !== fullRows) throw new Error(`year row mismatch full pages: ${fullRows} vs ${balRows}`);
await page.screenshot({ path: path.join(SCRATCH, "drawdown-ui.png"), fullPage: true });
push("screenshot_drawdown=drawdown-ui.png");

// Back to planner
await page.getByTestId("link-back-planner").click();
await page.getByTestId("results-panel").waitFor({ timeout: 30000 });
push("back_to_planner=true");

// MC secondary
await page.getByTestId("run-mc").click();
await page.waitForFunction(
  () => {
    const el = document.querySelector('[data-testid="success-rate"]');
    return el && el.textContent && el.textContent.includes("%");
  },
  null,
  { timeout: 180000 }
);
const mcSuccess = await page.getByTestId("success-rate").innerText();
push("mc_success_rate=" + mcSuccess);

await page.screenshot({ path: path.join(SCRATCH, "ui-review.png"), fullPage: true });
push("screenshot=ui-review.png");

// Scenario: save, mutate, load, expect recompute + restored spending
await page.getByRole("button", { name: /Scenarios/i }).click();
await page.getByTestId("save-scenario").click();
const listText = await page.getByTestId("scenario-list").innerText();
push("scenario_saved=" + /Our plan|plan/i.test(listText));

await page.getByRole("button", { name: /Lifestyle/i }).click();
const spendInput = page.locator('[data-testid="lifestyle-fields"] label.field').filter({ hasText: /Annual spending/i }).locator("input");
const originalSpend = await spendInput.inputValue();
await spendInput.fill("111111");
push("mutated_spending=111111 from " + originalSpend);

await page.getByRole("button", { name: /Scenarios/i }).click();
const first = page.locator('[data-testid="scenario-list"] button.linkish').first();
await first.click();
// wait for re-analyze after load
await page.getByTestId("hero-metrics").waitFor({ timeout: 180000 });
await page.getByRole("button", { name: /Lifestyle/i }).click();
// start year should be a full Jan-1 year (default next year when not Jan 1)
const startYearLabel = page.locator("label.field").filter({ hasText: /Simulation start year/i });
push("has_start_year_label=" + String((await startYearLabel.count()) > 0));
const spending = await page
  .locator('[data-testid="lifestyle-fields"] label.field')
  .filter({ hasText: /Annual spending/i })
  .locator("input")
  .inputValue();
push("scenario_restored_spending=" + spending);
if (spending !== originalSpend) {
  throw new Error(`scenario load did not restore spending: got ${spending}, want ${originalSpend}`);
}

// savings / LIF knobs present on spouse tab
await page.getByRole("button", { name: /Alex|2 ·/i }).click();
const body = await page.getByTestId("inputs-panel").innerText();
push("has_savings_ui=" + /While working|RRSP mode|Workplace DC/i.test(body));
push("has_lif_unlock=" + /Unlock 50%/i.test(body));
push("has_younger_rrif=" + /younger spouse/i.test(body));

await page.screenshot({ path: path.join(SCRATCH, "ui-review-final.png"), fullPage: true });

push("page_errors=" + errors.length);
if (errors.length) push("errors=" + JSON.stringify(errors.slice(0, 8)));

if (!/Horizon/i.test(h1) && !/Horizon/i.test(await page.title())) throw new Error("missing Horizon brand");
if (!/estimates/i.test(disclaimer)) throw new Error("missing disclaimer");
if (!estate || estate === "—") throw new Error("empty estate");
if (!tax || tax === "—") throw new Error("empty tax");
if (!naiveTax || naiveTax === "—") throw new Error("missing naive baseline");
if (!table || !wchart) throw new Error("missing cashflow visuals");
if (!mcSuccess.includes("%")) throw new Error("mc success missing");
if (!/Alex/i.test(ddText) || !/Jordan/i.test(ddText)) throw new Error("drawdown missing spouse names");
if (errors.length) throw new Error("page errors: " + errors.join("; "));

fs.writeFileSync(path.join(SCRATCH, "ui-review-smoke.log"), log.join("\n") + "\n");
fs.writeFileSync(path.join(SCRATCH, "ui-smoke.log"), log.join("\n") + "\n");
fs.writeFileSync(path.join(SCRATCH, "drawdown-ui-smoke.log"), log.join("\n") + "\n");
fs.writeFileSync(path.join(SCRATCH, "tax-explain-ui-smoke.log"), log.join("\n") + "\n");
fs.writeFileSync(
  path.join(SCRATCH, "scenario-persist.log"),
  `scenario_saved=true\nlist=${listText.slice(0, 200)}\noriginal=${originalSpend}\nrestored=${spending}\nrestore_ok=true\n`
);
await browser.close();
push("SMOKE_OK");
