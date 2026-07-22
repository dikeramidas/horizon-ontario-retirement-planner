import type { HouseholdInput, PersonInput } from "../simulate";
import { defaultStartYear } from "./defaultStartYear";

const returns = { rrsp: 0.055, lira: 0.05, dcPension: 0.055, tfsa: 0.05, unregistered: 0.06 };

export function samplePersonA(): PersonInput {
  return {
    name: "Alex",
    birthYear: 1975,
    retirementAge: 62,
    salaryToday: 135_000,
    salaryRealGrowth: 0.01,
    savings: {
      rrsp: { type: "pctOfSalary", pct: 0.12 },
      tfsa: { type: "fixed", amount: 7_000 },
      unregistered: { type: "none" },
      dc: { type: "pctOfSalary", pct: 0.05 },
    },
    reinvestRrspRefund: true,
    rrspRoomNow: 48_000,
    tfsaRoomNow: 22_000,
    cpp: { annualAt65Today: 15_200, startAge: 65 },
    oas: { startAge: 65, residenceYears: 40 },
    balances: {
      rrsp: 720_000,
      lira: 0,
      dcPension: 180_000,
      tfsa: 95_000,
      unregistered: { balance: 140_000, acb: 95_000 },
    },
    returns,
    unregisteredDistribution: {
      interestFrac: 0.1,
      eligibleDividendFrac: 0.35,
      realizedGainFrac: 0.2,
    },
    lifUnlock50: true,
    rrifUseYoungerSpouseAge: true,
  };
}

export function samplePersonB(): PersonInput {
  return {
    name: "Jordan",
    birthYear: 1978,
    retirementAge: 60,
    salaryToday: 98_000,
    salaryRealGrowth: 0.01,
    savings: {
      rrsp: { type: "pctOfSalary", pct: 0.1 },
      tfsa: { type: "fixed", amount: 5_000 },
      unregistered: { type: "none" },
    },
    reinvestRrspRefund: true,
    rrspRoomNow: 31_000,
    tfsaRoomNow: 40_000,
    cpp: { annualAt65Today: 11_800, startAge: 65 },
    oas: { startAge: 65, residenceYears: 40 },
    db: {
      currentAnnualEntitlementToday: 28_000,
      accrualPerYearToday: 1_400,
      startAge: 60,
      indexedToCpi: true,
    },
    balances: {
      rrsp: 410_000,
      lira: 95_000,
      tfsa: 72_000,
      unregistered: { balance: 40_000, acb: 32_000 },
    },
    returns,
    unregisteredDistribution: {
      interestFrac: 0.15,
      eligibleDividendFrac: 0.3,
      realizedGainFrac: 0.15,
    },
    lifUnlock50: true,
    rrifUseYoungerSpouseAge: true,
  };
}

/** Default filled couple so first-run produces real charts. */
export function sampleHousehold(): HouseholdInput {
  return {
    startYear: defaultStartYear(),
    inflation: 0.021,
    spendingTargetToday: 95_000,
    horizonAgeYoungerSpouse: 95,
    strategy: {
      topUpCeilingToday: 85_000,
      tfsaLevel: "l4",
      tfsaReserveYears: 2,
      tfsaFirstShare: 0,
    },
    solverQuality: "thorough",
    persons: [samplePersonA(), samplePersonB()],
  };
}
