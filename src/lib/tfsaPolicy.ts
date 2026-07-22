/**
 * Year-by-year TFSA vs taxable withdrawal policy (L1–L4).
 *
 * L1: Fill taxable sources only up to income ceiling C, then TFSA, then taxable overflow.
 * L2: Income cap = min(C, OAS clawback threshold) when OAS-aware (C=0 → OAS only).
 * L3: Hold a TFSA reserve (N × spending) unless needed to fund spending.
 * L4: Multi-year grid search over "TFSA-first share" of discretionary W on deterministic path.
 */

export type TfsaLevel = "legacy" | "l1" | "l2" | "l3" | "l4";

export interface TfsaStrategyOptions {
  level: TfsaLevel;
  /** Nominal taxable-income ceiling for the year (CPI-scaled C). */
  incomeCeiling: number;
  /** Year-scaled OAS clawback threshold (L2+). */
  oasThreshold: number;
  /** Base taxable income per spouse before discretionary withdrawals. */
  baseTaxable: [number, number];
  /** Caps on discretionary gross by account. */
  caps: Array<{ unreg: number; reg: number; lif: number; tfsa: number }>;
  /** Unregistered gain fraction (0..1); taxable ≈ gross × gainFrac × 0.5. */
  gainFrac: [number, number];
  /** L3+: dollars of TFSA to try to keep (household). */
  tfsaReserveTotal: number;
  /**
   * L4: fraction of discretionary W taken from TFSA first (0..1).
   * 0 = pure L3 ordering (taxable-to-cap → TFSA → overflow).
   */
  tfsaFirstShare: number;
}

export interface WithdrawalAlloc {
  tU: [number, number];
  tR: [number, number];
  tL: [number, number];
  tT: [number, number];
}

/** Taxable income per $1 gross unregistered withdrawal (50% inclusion × gain frac). */
export function unregTaxablePerDollar(gainFrac: number): number {
  return Math.max(0, gainFrac) * 0.5;
}

/**
 * Closed-form two-person allocation minimizing max taxable income.
 */
export function allocateEq(
  amount: number,
  cap0: number,
  cap1: number,
  d0: number,
  d1: number,
  t0: number,
  t1: number
): [number, number, number] {
  let out0 = 0, out1 = 0;
  let left = Math.max(0, amount);
  if (d0 <= 1e-12 && d1 <= 1e-12) {
    const tot = cap0 + cap1;
    if (tot > 0) {
      let take = Math.min(left * (cap0 / tot), cap0, left); out0 += take; left -= take;
      take = Math.min(left, cap1); out1 += take; left -= take;
      take = Math.min(left, cap0 - out0); out0 += take; left -= take;
    }
  } else if (d0 <= 1e-12) {
    let take = Math.min(left, cap0); out0 += take; left -= take;
    take = Math.min(left, cap1); out1 += take; left -= take;
  } else if (d1 <= 1e-12) {
    let take = Math.min(left, cap1); out1 += take; left -= take;
    take = Math.min(left, cap0); out0 += take; left -= take;
  } else {
    if (t0 <= t1) { const take = Math.min((t1 - t0) / d0, cap0, left); out0 += take; left -= take; }
    else { const take = Math.min((t0 - t1) / d1, cap1, left); out1 += take; left -= take; }
    for (let guard = 0; guard < 4 && left > 1e-9; guard++) {
      const can0 = out0 < cap0 - 1e-9, can1 = out1 < cap1 - 1e-9;
      if (can0 && can1) {
        const l = left, share0 = d1 / (d0 + d1);
        let take = Math.min(l * share0, cap0 - out0, left); out0 += take; left -= take;
        take = Math.min(l * (1 - share0), cap1 - out1, left); out1 += take; left -= take;
      } else if (can0) { const take = Math.min(left, cap0 - out0); out0 += take; left -= take; }
      else if (can1) { const take = Math.min(left, cap1 - out1); out1 += take; left -= take; }
      else break;
    }
  }
  return [out0, out1, left];
}

/** Max taxable income allowed per spouse under L1/L2 caps. */
export function personIncomeTargets(
  level: TfsaLevel,
  incomeCeiling: number,
  oasThreshold: number
): [number, number] {
  if (level === "legacy") return [1e15, 1e15];
  let cap: number;
  if (level === "l1") {
    // C=0 → no taxable discretionary under cap (all TFSA first, then overflow)
    cap = incomeCeiling > 0 ? incomeCeiling : 0;
  } else {
    // L2+: min(C, OAS) when both set; OAS only if C=0; C only if no OAS
    if (incomeCeiling > 0 && oasThreshold > 0) cap = Math.min(incomeCeiling, oasThreshold);
    else if (oasThreshold > 0) cap = oasThreshold;
    else if (incomeCeiling > 0) cap = incomeCeiling;
    else cap = 0;
  }
  return [cap, cap];
}

function unregGrossForIncomeRoom(roomInc: number, gainFrac: number, hardCap: number): number {
  const tpd = unregTaxablePerDollar(gainFrac);
  if (tpd <= 1e-12) return hardCap;
  return Math.min(hardCap, Math.max(0, roomInc) / tpd);
}

/**
 * Allocate discretionary gross W under L1–L4 policy.
 */
export function allocateDiscretionaryW(W: number, opt: TfsaStrategyOptions): WithdrawalAlloc {
  if (opt.level === "legacy") {
    return allocateLegacyTfsaLast(W, opt);
  }

  let left = Math.max(0, W);
  const usedU: [number, number] = [0, 0];
  const usedR: [number, number] = [0, 0];
  const usedL: [number, number] = [0, 0];
  const usedT: [number, number] = [0, 0];
  const caps = opt.caps.map((c) => ({ unreg: c.unreg, reg: c.reg, lif: c.lif, tfsa: c.tfsa }));
  let tInc: [number, number] = [opt.baseTaxable[0], opt.baseTaxable[1]];
  const target = personIncomeTargets(opt.level, opt.incomeCeiling, opt.oasThreshold);

  const takeTaxable = (kind: "unreg" | "reg" | "lif", underCap: boolean) => {
    if (left <= 1e-9) return;
    const room0 = Math.max(0, target[0] - tInc[0]);
    const room1 = Math.max(0, target[1] - tInc[1]);
    let c0 = kind === "unreg" ? caps[0].unreg : kind === "reg" ? caps[0].reg : caps[0].lif;
    let c1 = kind === "unreg" ? caps[1].unreg : kind === "reg" ? caps[1].reg : caps[1].lif;
    if (underCap) {
      if (kind === "unreg") {
        c0 = unregGrossForIncomeRoom(room0, opt.gainFrac[0], c0);
        c1 = unregGrossForIncomeRoom(room1, opt.gainFrac[1], c1);
      } else {
        c0 = Math.min(c0, room0);
        c1 = Math.min(c1, room1);
      }
    }
    if (c0 + c1 <= 1e-12) return;
    const d0 = kind === "unreg" ? unregTaxablePerDollar(opt.gainFrac[0]) : 1;
    const d1 = kind === "unreg" ? unregTaxablePerDollar(opt.gainFrac[1]) : 1;
    const budget = Math.min(left, c0 + c1);
    const [a0, a1] = allocateEq(budget, c0, c1, d0, d1, tInc[0], tInc[1]);
    const taken = a0 + a1;
    if (taken <= 1e-12) return;
    if (kind === "unreg") {
      usedU[0] += a0; usedU[1] += a1;
      caps[0].unreg = Math.max(0, caps[0].unreg - a0);
      caps[1].unreg = Math.max(0, caps[1].unreg - a1);
    } else if (kind === "reg") {
      usedR[0] += a0; usedR[1] += a1;
      caps[0].reg = Math.max(0, caps[0].reg - a0);
      caps[1].reg = Math.max(0, caps[1].reg - a1);
    } else {
      usedL[0] += a0; usedL[1] += a1;
      caps[0].lif = Math.max(0, caps[0].lif - a0);
      caps[1].lif = Math.max(0, caps[1].lif - a1);
    }
    tInc[0] += a0 * d0;
    tInc[1] += a1 * d1;
    left = Math.max(0, left - taken);
  };

  const takeTfsa = (breachReserve: boolean) => {
    if (left <= 1e-9) return;
    let c0 = caps[0].tfsa, c1 = caps[1].tfsa;
    if (!breachReserve && opt.tfsaReserveTotal > 0 && (opt.level === "l3" || opt.level === "l4")) {
      const avail = Math.max(0, c0 + c1 - opt.tfsaReserveTotal);
      if (avail <= 1e-9) return;
      const tot = c0 + c1;
      if (tot > 1e-9) {
        c0 *= avail / tot;
        c1 *= avail / tot;
      }
    }
    if (c0 + c1 <= 1e-12) return;
    const [a0, a1] = allocateEq(Math.min(left, c0 + c1), c0, c1, 0, 0, tInc[0], tInc[1]);
    const taken = a0 + a1;
    if (taken <= 1e-12) return;
    usedT[0] += a0; usedT[1] += a1;
    caps[0].tfsa = Math.max(0, caps[0].tfsa - a0);
    caps[1].tfsa = Math.max(0, caps[1].tfsa - a1);
    left = Math.max(0, left - taken);
  };

  // L4: TFSA-first share (respect reserve)
  const share = opt.level === "l4" ? Math.min(1, Math.max(0, opt.tfsaFirstShare)) : 0;
  if (share > 1e-12) {
    const want = left * share;
    const before = left;
    left = want;
    takeTfsa(false);
    const got = want - left;
    left = before - got;
  }

  // Taxable under income cap
  takeTaxable("unreg", true);
  takeTaxable("reg", true);
  takeTaxable("lif", true);

  // TFSA respecting reserve
  takeTfsa(false);

  // Overflow: breach reserve, then taxable beyond cap
  takeTfsa(true);
  takeTaxable("unreg", false);
  takeTaxable("reg", false);
  takeTaxable("lif", false);

  return { tU: usedU, tR: usedR, tL: usedL, tT: usedT };
}

function allocateLegacyTfsaLast(W: number, opt: TfsaStrategyOptions): WithdrawalAlloc {
  let left = Math.max(0, W);
  const c = opt.caps.map((x) => ({ ...x }));
  const g = opt.gainFrac;
  const bt = opt.baseTaxable;
  const [u0, u1] = allocateEq(
    Math.min(left, c[0].unreg + c[1].unreg),
    c[0].unreg, c[1].unreg, g[0] * 0.5, g[1] * 0.5, bt[0], bt[1]
  );
  left -= u0 + u1;
  const a0 = bt[0] + u0 * g[0] * 0.5, a1 = bt[1] + u1 * g[1] * 0.5;
  const [r0, r1] = allocateEq(Math.min(left, c[0].reg + c[1].reg), c[0].reg, c[1].reg, 1, 1, a0, a1);
  left -= r0 + r1;
  const b0 = a0 + r0, b1 = a1 + r1;
  const [l0, l1] = allocateEq(Math.min(left, c[0].lif + c[1].lif), c[0].lif, c[1].lif, 1, 1, b0, b1);
  left -= l0 + l1;
  const [t0, t1] = allocateEq(left, c[0].tfsa, c[1].tfsa, 0, 0, b0, b1);
  return { tU: [u0, u1], tR: [r0, r1], tL: [l0, l1], tT: [t0, t1] };
}

/** L3 reserve dollars from years-of-spending × current nominal spending target. */
export function tfsaReserveDollars(
  level: TfsaLevel,
  reserveYears: number,
  spendingTargetNominal: number,
  totalTfsaCap: number
): number {
  if (level !== "l3" && level !== "l4") return 0;
  if (reserveYears <= 0 || spendingTargetNominal <= 0) return 0;
  return Math.min(totalTfsaCap, reserveYears * spendingTargetNominal);
}

export const L4_SHARE_GRID = [0, 0.2, 0.4, 0.6, 0.8, 1.0] as const;

export function resolveTfsaLevel(raw: TfsaLevel | undefined): TfsaLevel {
  if (raw === "legacy" || raw === "l1" || raw === "l2" || raw === "l3" || raw === "l4") return raw;
  return "l4"; // product default: full policy stack
}

/** Short labels for Strategy tab (A8). */
export const TFSA_LEVEL_OPTIONS: Array<{ value: TfsaLevel; label: string; hint: string }> = [
  {
    value: "legacy",
    label: "Legacy (TFSA last)",
    hint: "Spend from taxable accounts first; TFSA last — classic ordering.",
  },
  {
    value: "l1",
    label: "L1 — fill to ceiling C",
    hint: "Taxable sources up to top-up ceiling C, then TFSA, then overflow.",
  },
  {
    value: "l2",
    label: "L2 — OAS-aware cap",
    hint: "Like L1 but income cap respects OAS clawback threshold when relevant.",
  },
  {
    value: "l3",
    label: "L3 — TFSA reserve",
    hint: "Hold N years of spending in TFSA when possible (see reserve years).",
  },
  {
    value: "l4",
    label: "L4 — reserve + share search",
    hint: "L3 plus a search for how much discretionary withdrawal comes from TFSA first (default).",
  },
];
