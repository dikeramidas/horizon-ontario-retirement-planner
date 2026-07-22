import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { analyzePlan } from "./analysis";
import { buildCashflowCsv, buildExportHtml } from "./exportPlan";

describe("exportPlan", () => {
  it("builds HTML summary and CSV from a real analysis path", () => {
    const h = sampleHousehold();
    for (const p of h.persons) p.db = undefined;
    const a = analyzePlan(h, { quick: true });
    const html = buildExportHtml({
      input: h,
      personNames: ["Alex", "Jordan"],
      det: a.primary,
      tune: a.tune,
      mc: null,
      generatedAt: "2026-07-21T12:00:00.000Z",
    });
    expect(html).toContain("Horizon");
    expect(html).toContain("2026");
    expect(html).toContain("Alex");
    expect(html).toMatch(/After-tax estate|estate/i);
    expect(html).toMatch(/estimates/i);
    expect(html).toMatch(/v\d+\.\d+\.\d+/);

    const csv = buildCashflowCsv(a.primary);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("year");
    expect(lines[0]).toContain("spending");
    expect(lines.length).toBeGreaterThan(5);
    // data rows are numeric-ish
    expect(lines[1]).toMatch(/^\d{4},/);
  }, 60_000);
});
