import { useEffect, useState } from "react";

/** Normalize location.hash → path like `/`, `/drawdown/withdrawals`. */
export function readHashPath(): string {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path.split("?")[0] || "/";
}

export function navigateHash(path: string): void {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (readHashPath() === p) return;
  window.location.hash = p === "/" ? "" : p;
}

export function useHashRoute(): string {
  const [path, setPath] = useState(readHashPath);
  useEffect(() => {
    const onHash = () => setPath(readHashPath());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return path;
}

export type DrawdownFullMode = "withdrawals" | "balances";

export function parseDrawdownRoute(path: string): DrawdownFullMode | null {
  if (path === "/drawdown/withdrawals" || path === "/drawdown/withdrawal") return "withdrawals";
  if (path === "/drawdown/balances" || path === "/drawdown/balance") return "balances";
  return null;
}
