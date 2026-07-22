/** A1 — consistent unit labeling for figures. */

export type MoneyUnit = "real" | "nominal";

export function UnitBadge({ unit }: { unit: MoneyUnit }) {
  const label = unit === "real" ? "today’s $" : "nominal year-$";
  const title =
    unit === "real"
      ? "Inflation-adjusted to today’s purchasing power (÷ CPI along the path)."
      : "Dollars of that calendar year — not deflated for inflation.";
  return (
    <span className={`unit-badge unit-badge-${unit}`} title={title} data-testid={`unit-${unit}`}>
      {label}
    </span>
  );
}
