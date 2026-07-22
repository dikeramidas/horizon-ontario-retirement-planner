import { describe, it, expect } from "vitest";
import { GLOSSARY, glossaryTitle } from "./glossary";

describe("glossary", () => {
  it("has core P0 terms with non-empty copy", () => {
    for (const key of [
      "hhTax",
      "meltdown",
      "topUpCeiling",
      "oasZone",
      "nominal",
      "real",
      "estateTax",
      "longevity",
    ] as const) {
      expect(GLOSSARY[key].term.length).toBeGreaterThan(2);
      expect(GLOSSARY[key].short.length).toBeGreaterThan(10);
      expect(glossaryTitle(key)).toContain(GLOSSARY[key].short.slice(0, 12));
    }
  });
});
