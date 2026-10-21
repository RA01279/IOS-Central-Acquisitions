import type { Tenant, UwInputs } from "./types";
import { buildUwView } from "./view-model";
import { rendon } from "./fixtures/rendon";

/** Changing the displayed period must preserve annual contract and rollover rent. */
export function convertTenantRentPeriod(tenant: Tenant, period: Tenant["rentPeriod"]): Tenant {
  if (tenant.rentPeriod === period) return tenant;
  const factor = period === "Annual" ? 12 : 1 / 12;
  return { ...tenant, rentPeriod: period, rent: tenant.rent * factor,
    renewalRent: tenant.renewalRent == null ? tenant.renewalRent : tenant.renewalRent * factor,
    newDealRent: tenant.newDealRent == null ? tenant.newDealRent : tenant.newDealRent * factor };
}

export interface UwDealSeed {
  id: string;
  property: string;
  acres: number | null;
  price: number | null;
  priceSource: string;
}

export function restoreUwSnapshot(text: string, seed: UwDealSeed) {
  const snapshot = JSON.parse(text);
  if (snapshot.schema !== "hopper-ios-uw-v1" || snapshot.dealId !== seed.id) throw new Error("This snapshot does not belong to this deal or uses an unsupported format.");
  if (typeof snapshot.sample !== "boolean" || typeof snapshot.vacant !== "boolean" || snapshot.capitalReviewed !== true) throw new Error("The snapshot is missing its review state.");
  if (!Array.isArray(snapshot.inputs?.rentRoll) || !Array.isArray(snapshot.inputs?.capex)) throw new Error("The snapshot is missing its rent roll or capital plan.");
  if (!snapshot.inputs.rentRoll.length && !snapshot.vacant) throw new Error("The snapshot needs a rent roll or explicit vacancy confirmation.");
  if (snapshot.inputs.property !== (snapshot.sample ? rendon.property : seed.property)) throw new Error("The snapshot property does not match its declared deal or reference sample.");
  const inputs = snapshot.inputs as UwInputs;
  // Saved output is intentionally ignored. Always recalculate from the inputs.
  return { inputs, sample: snapshot.sample as boolean, vacant: snapshot.vacant as boolean, view: buildUwView(inputs) };
}

/** Deal facts only; unknown operating expenses remain blank, never assumed zero. */
export function createUwDraft(seed: UwDealSeed): UwInputs {
  return {
    property: seed.property, scenario: "Base",
    levers: { RentGrowth: [0.03, 0.04, 0.015], Vacancy: [0.05, 0.03, 0.1], ExitCap: [0.07, 0.065, 0.0775], CapexOverrun: [0, 0, 0.15], LeaseDelay: [0, 0, 6], RenewProb: [0.7, 0.8, 0.5] },
    Acres: seed.acres ?? NaN, PurchPrice: seed.price ?? NaN, CompPerAcre: 0,
    CloseCost: 0.015, SaleCost: 0.02, Hold: 7, TgtUnlev: 0.1, TgtLev: 0.15, MinDSCR: 1.25, StepG: 0.01, StepCap: 0.005,
    SellerTax: 0, Insurance: NaN, TaxSwitch: 1, TaxRate: NaN, MgmtPct: NaN, ReservePerAcre: NaN, OtherOpex: NaN, ExpGrowth: 0.03,
    LevOn: 1, LoanLTV: 0.55, LoanRate: 0.0675, AmortYrs: 25, IOYrs: 2, LoanFee: 0.01,
    RollMethod: 1, rentRoll: [], capex: [],
  };
}
