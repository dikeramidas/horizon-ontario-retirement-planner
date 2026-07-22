import { describe, it, expect } from "vitest";
import { sampleHousehold } from "./sampleHousehold";
import { simulate } from "../simulate";
import { tfsaRoomSeries } from "./tfsaRoomSeries";

describe("tfsaRoomSeries", () => {
  it("exposes room and balances from a real path", () => {
    const r = simulate({ ...sampleHousehold(), solverQuality: "thorough" });
    const s = tfsaRoomSeries(r, false);
    expect(s.length).toBe(r.rows.length);
    expect(s[0].roomTotal).toBeGreaterThanOrEqual(0);
    expect(s.some((y) => y.balanceTotal > 0)).toBe(true);
  });
});
