import { describe, it, expect } from "vitest";
import { parseDrawdownRoute } from "./hashRoute";

describe("parseDrawdownRoute", () => {
  it("recognizes full-page drawdown paths", () => {
    expect(parseDrawdownRoute("/drawdown/withdrawals")).toBe("withdrawals");
    expect(parseDrawdownRoute("/drawdown/balances")).toBe("balances");
    expect(parseDrawdownRoute("/")).toBeNull();
    expect(parseDrawdownRoute("/drawdown")).toBeNull();
  });
});
