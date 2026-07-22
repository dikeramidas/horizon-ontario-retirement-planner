/**
 * Person-level meltdown / TFSA parking helpers.
 * - Prefer draining the larger registered pile first
 * - Park surplus into TFSA room aggressively (most room first)
 * - Optionally scale top-ups so after-tax surplus fits remaining TFSA room
 */

export type TopUpPriority = "equal" | "prefer0" | "prefer1" | "higherReg";

export function personOrder(
  priority: TopUpPriority | undefined,
  regBalance0: number,
  regBalance1: number
): [0 | 1, 0 | 1] {
  const p = priority ?? "higherReg";
  if (p === "prefer0") return [0, 1];
  if (p === "prefer1") return [1, 0];
  if (p === "higherReg") return regBalance0 >= regBalance1 ? [0, 1] : [1, 0];
  return [0, 1];
}

/** Order spouses by remaining TFSA room (most room first). */
export function roomFirstOrder(room0: number, room1: number): [0 | 1, 0 | 1] {
  return room0 >= room1 ? [0, 1] : [1, 0];
}

/**
 * Per-person top-up amounts under individual ceilings (year-$).
 * Fills people in `order` so the preferred spouse uses their room under C first.
 */
export function assignPersonTopUps(
  ceilingYear: [number, number],
  preTaxable: [number, number],
  regCapLeft: [number, number],
  order: [0 | 1, 0 | 1]
): [number, number] {
  const top: [number, number] = [0, 0];
  for (const i of order) {
    const underC = Math.max(0, ceilingYear[i] - preTaxable[i]);
    top[i] = Math.min(underC, Math.max(0, regCapLeft[i]));
  }
  return top;
}

/**
 * Park surplus into TFSA by most remaining room first (aggressive room use).
 * Returns per-person TFSA adds and residual (to unregistered).
 */
export function parkSurplusTfsaFirst(
  surplus: number,
  rooms: [number, number],
  alive: [boolean, boolean] = [true, true]
): { tfsaAdd: [number, number]; residual: number } {
  let left = Math.max(0, surplus);
  const tfsaAdd: [number, number] = [0, 0];
  const effective: [number, number] = [
    alive[0] ? Math.max(0, rooms[0]) : 0,
    alive[1] ? Math.max(0, rooms[1]) : 0,
  ];
  const order = roomFirstOrder(effective[0], effective[1]);
  for (const i of order) {
    if (left <= 1e-9) break;
    const add = Math.min(left, effective[i]);
    tfsaAdd[i] = add;
    left -= add;
  }
  return { tfsaAdd, residual: left };
}

/**
 * Scale top-ups so estimated after-tax proceeds fit household TFSA room.
 * Uses a simple average marginal rate (default 35%) — not full tax re-solve.
 */
export function scaleTopUpsToTfsaRoom(
  topUps: [number, number],
  tfsaRoomTotal: number,
  afterTaxFrac = 0.65
): [number, number] {
  const gross = topUps[0] + topUps[1];
  if (gross <= 1e-9) return topUps;
  const room = Math.max(0, tfsaRoomTotal);
  if (room <= 1e-9) {
    // No room: still allow top-ups (estate/tax timing) but no forced scale to zero —
    // only scale when room exists and would be exceeded.
    return topUps;
  }
  const afterTax = gross * afterTaxFrac;
  if (afterTax <= room + 1e-6) return topUps;
  const scale = room / afterTax;
  return [topUps[0] * scale, topUps[1] * scale];
}

/**
 * Split a household flat C into person ceilings proportional to registered balances,
 * with a floor so neither is starved (min 25% of C each when both have balances).
 */
export function splitCeilingByRegistered(
  flatC: number,
  reg0: number,
  reg1: number
): [number, number] {
  const tot = reg0 + reg1;
  if (flatC <= 0) return [0, 0];
  if (tot <= 1e-6) return [flatC / 2, flatC / 2];
  let w0 = reg0 / tot;
  let w1 = reg1 / tot;
  // 25% floor when both have material balances
  if (reg0 > 1000 && reg1 > 1000) {
    w0 = Math.max(0.25, Math.min(0.75, w0));
    w1 = 1 - w0;
  }
  return [flatC * w0, flatC * w1];
}
