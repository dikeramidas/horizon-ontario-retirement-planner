/** B7 — year-by-year household TFSA room from a simulation path. */
import type { SimulationResult } from "../simulate";

export interface TfsaRoomYear {
  year: number;
  roomA: number;
  roomB: number;
  roomTotal: number;
  balanceA: number;
  balanceB: number;
  balanceTotal: number;
  /** TFSA withdrawals that year (both spouses). */
  withdrawn: number;
  /** TFSA contributions / surplus parked that year. */
  contributed: number;
}

export function tfsaRoomSeries(
  result: SimulationResult,
  retirementOnly = false
): TfsaRoomYear[] {
  return result.rows
    .filter((r) => !retirementOnly || r.solverActive)
    .map((r) => {
      const a = r.persons[0];
      const b = r.persons[1];
      return {
        year: r.year,
        roomA: a.roomsEnd.tfsa,
        roomB: b.roomsEnd.tfsa,
        roomTotal: a.roomsEnd.tfsa + b.roomsEnd.tfsa,
        balanceA: a.balancesEnd.tfsa,
        balanceB: b.balancesEnd.tfsa,
        balanceTotal: a.balancesEnd.tfsa + b.balancesEnd.tfsa,
        withdrawn: a.withdrawals.tfsa + b.withdrawals.tfsa,
        contributed:
          a.contributions.tfsa +
          b.contributions.tfsa +
          (r.surplusToTfsa > 0 ? r.surplusToTfsa : 0),
      };
    });
}
