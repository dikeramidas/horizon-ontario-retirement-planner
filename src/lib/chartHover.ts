/** Shared hover nearest-index helper for SVG charts (A9). */

export function nearestIndex(clientX: number, svg: SVGSVGElement, n: number, padL: number, padR: number): number {
  if (n <= 1) return 0;
  const rect = svg.getBoundingClientRect();
  const viewW = svg.viewBox.baseVal?.width || 640;
  const scale = rect.width / viewW;
  const xSvg = (clientX - rect.left) / scale;
  const innerL = padL;
  const innerR = viewW - padR;
  const t = (xSvg - innerL) / (innerR - innerL || 1);
  return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
}

export function moneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}
