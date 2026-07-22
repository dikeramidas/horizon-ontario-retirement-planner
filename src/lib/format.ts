/** Pure display formatters — unit-testable without a browser. */

export function money(
  n: number,
  opts: { compact?: boolean; /** Shorter $95K-style for dense tables */ dense?: boolean; digits?: number } = {}
): string {
  if (!Number.isFinite(n)) return "—";
  if (opts.dense && Math.abs(n) >= 1_000) {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      notation: "compact",
      maximumFractionDigits: Math.abs(n) >= 100_000 ? 1 : 0,
    }).format(n);
  }
  if (opts.compact && Math.abs(n) >= 1_000_000) {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: opts.digits ?? 0,
  }).format(n);
}

export function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: digits }).format(n);
}
