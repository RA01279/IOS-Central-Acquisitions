// lib/deals.ts
//
// createDeal() is the single entry point for getting a deal into the
// system. The New Deal form calls this today. When the shared inbox
// (acquisitions@dalfen.com) exists later, an email-triggered intake
// agent becomes a second caller of this same function — no schema or
// workflow changes required at that point.

import { getServiceClient } from "./supabase";
import { fireStageChangeWebhook } from "./webhooks";

export type MlaStatus = "pending" | "requested" | "provided" | "assumed";
// 'lease' is legacy: leasing was removed from the UI in Aug 2026 but the rows
// and the deal_type column were deliberately kept, so anything that READS
// deals still has to cope with lease rows. Nothing creates them any more.
export type DealType = "acquisition" | "lease";
export type AssetClass = "ios" | "industrial";

// Ordered pipeline stages (excludes the 'archived' terminal). Keep in sync with
// the deals_stage_check / deals_stage_for_type constraints in
// 0016_pipeline_bifurcation.sql.
// Deals enter at Prospect and move to UW only when a model (underwriting Excel)
// is uploaded -- see the versions route. UW v1 was retired when Prospect took
// over the "no model yet" role; it survives only in STAGE_LABELS so old events
// and archived deals still render.
export const ACQUISITION_STAGES = [
  "prospect",
  "uw",
  "offered",
  "moving_to_psa",
  "due_diligence",
  "closed",
] as const;

// "In contract" for reporting: the PSA is agreed (Moving to PSA) or executed
// and we're in diligence. Both are money-on-the-table stages, which is what
// the home screen's in-contract subtotal means.
export const IN_CONTRACT_STAGES = ["moving_to_psa", "due_diligence"] as const;

export const STAGE_LABELS: Record<string, string> = {
  uw: "UW",
  uw_v1: "UW v1", // legacy -- display only
  offered: "Offered",
  moving_to_psa: "Moving to PSA",
  due_diligence: "Due Diligence",
  closed: "Closed",
  prospect: "Prospect",
  archived: "Archived",
  // Legacy leasing stages -- display only, so historical rows and death_stage
  // values still render a human label.
  tour: "Tour",
  proposal: "Proposal (LOI)",
  negotiation: "Negotiation",
  executed: "Executed",
};

export const ASSET_CLASSES = ["ios", "industrial"] as const;
export const ASSET_CLASS_LABELS: Record<string, string> = {
  ios: "IOS",
  industrial: "Industrial",
};

// Every acquisition opens at Prospect. Enforced in the DB by
// deals_stage_for_type (see 0016).
export const OPENING_STAGE = "prospect";

// properties.asset_type has four values; the pipeline has two. IOS is IOS,
// everything else is Industrial, and an unclassified legacy row is IOS (this
// started as an IOS-only tracker). Used to seed asset_class at intake and on
// edit; after that asset_class is authoritative and independently editable.
export function assetClassFromAssetType(assetType?: string | null): AssetClass {
  if (!assetType || assetType === "ios") return "ios";
  return "industrial";
}

export function isValidAcqStage(stage: string): boolean {
  return (ACQUISITION_STAGES as readonly string[]).includes(stage);
}

export interface NewDealInput {
  address: string;
  market?: string;
  submarket?: string;
  city?: string;
  assetType: "ios" | "industrial" | "flex" | "other";
  // Which pipeline this deal shows up in. Defaults to whatever assetType
  // implies, so intake can leave it alone and still land in the right board.
  assetClass?: AssetClass;
  lotSf?: number;
  // The team thinks in acres (IOS land deals). If lotSf is absent and acres
  // is present, we convert (1 acre = 43,560 SF).
  acres?: number;
  buildingSf?: number;
  // From the 2026 Pipeline Tracker: was the deal marketed or off-market, and
  // what flavor of acquisition is it?
  marketingStatus?: "marketed" | "off_market";
  acquisitionType?: "standard" | "slb" | "unsolicited";
  // Current occupancy of the building at acquisition. WALT (weighted average
  // lease term remaining, years) is only meaningful when occupied.
  occupancyStatus?: "vacant" | "occupied";
  waltYears?: number;
  tenancy?: "single_tenant" | "multi_tenant";
  // Counterparty names typed at intake. Each becomes a contact (found by
  // exact name match, or created) linked to the deal via deal_contacts with
  // the matching role. Keeps intake fast without creating dead text columns.
  currentOwnerName?: string;
  buyerBrokerName?: string;
  sellerBrokerName?: string;
  sourceBrokerId?: string;
  createdBy: string; // who's entering this (Rhett, market lead, or later: "email-intake")
  // MLA is an acquisitions-underwriting concept. The "provided" variant
  // carries the full "MLA - Base Case" field set (0003 schema) so intake
  // matches the later provide-MLA step -- every field optional so a partial
  // MLA can still be entered.
  mla?:
    | {
        status: "provided";
        marketBaseRent?: number;
        termYears?: number;
        termMonths?: number;
        renewalProbability?: number;
        monthsVacant?: number;
        freeRentMonths?: number;
        tiNew?: number;
        tiRenew?: number;
        lcNewPct?: number;
        lcRenewPct?: number;
        recoveryType?: string;
        askingRent?: number; // legacy (0002) -- deprecated in favor of marketBaseRent
        opex?: number;
        otherAssumptions?: Record<string, unknown>;
      }
    | { status: "requested" }
    | { status: "assumed" };
}

export async function createDeal(input: NewDealInput) {
  const supabase = getServiceClient();

  const { data: property, error: propError } = await supabase
    .from("properties")
    .insert({
      address: input.address,
      market: input.market ?? null,
      submarket: input.submarket ?? null,
      city: input.city ?? null,
      asset_type: input.assetType,
      lot_sf: input.lotSf ?? (input.acres ? Math.round(input.acres * 43560) : null),
      building_sf: input.buildingSf ?? null,
      occupancy_status: input.occupancyStatus ?? null,
      walt_years: input.occupancyStatus === "occupied" ? input.waltYears ?? null : null,
      tenancy: input.tenancy ?? null,
    })
    .select()
    .single();

  if (propError) throw propError;

  const mlaStatus: MlaStatus = input.mla?.status ?? "assumed";
  const assetClass = input.assetClass ?? assetClassFromAssetType(input.assetType);

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .insert({
      property_id: property.id,
      deal_type: "acquisition",
      stage: OPENING_STAGE,
      asset_class: assetClass,
      source_broker_id: input.sourceBrokerId ?? null,
      mla_status: mlaStatus,
      marketing_status: input.marketingStatus ?? null,
      acquisition_type: input.acquisitionType ?? null,
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (dealError) throw dealError;

  if (input.mla?.status === "provided") {
    const m = input.mla;
    const { error: mlaError } = await supabase.from("mla_data").insert({
      deal_id: deal.id,
      market_base_rent: m.marketBaseRent ?? null,
      term_years: m.termYears ?? null,
      term_months: m.termMonths ?? null,
      renewal_probability: m.renewalProbability ?? null,
      months_vacant: m.monthsVacant ?? null,
      free_rent_months: m.freeRentMonths ?? null,
      ti_new: m.tiNew ?? null,
      ti_renew: m.tiRenew ?? null,
      lc_new_pct: m.lcNewPct ?? null,
      lc_renew_pct: m.lcRenewPct ?? null,
      recovery_type: m.recoveryType ?? null,
      asking_rent: m.askingRent ?? null, // legacy, kept for back-compat
      opex: m.opex ?? null,
      other_assumptions: m.otherAssumptions ?? {},
      provided_by: input.createdBy,
      provided_at: new Date().toISOString(),
    });
    if (mlaError) throw mlaError;
  }

  if (input.mla?.status === "requested") {
    await notifyMarketLeadForMla(deal.id, input.address);
  }

  // Link every typed counterparty as a contact on the deal.
  const counterparties = [
    { name: input.currentOwnerName, role: "seller", type: null }, // owner-user vs institutional: classified by hand
    { name: input.buyerBrokerName, role: "buyer_broker", type: "broker" },
    { name: input.sellerBrokerName, role: "seller_broker", type: "broker" },
  ];
  for (const cp of counterparties) {
    if (!cp.name?.trim()) continue;
    const contactId = await findOrCreateContactByName(cp.name.trim(), cp.type);
    const { error: linkError } = await supabase.from("deal_contacts").insert({
      deal_id: deal.id,
      contact_id: contactId,
      role: cp.role,
    });
    if (linkError) throw linkError;
    await logDealEvent(
      deal.id,
      "contact_linked",
      { contact_id: contactId, role: cp.role, via: "intake" },
      input.createdBy
    );
  }

  await logDealEvent(
    deal.id,
    "deal_created",
    { deal_type: "acquisition", asset_class: assetClass, mla_status: mlaStatus },
    input.createdBy
  );

  // Duplicate detection: check address history now that the deal exists.
  const duplicates = await findDuplicateDeals(input.address, deal.id);
  if (duplicates.length > 0) {
    await logDealEvent(deal.id, "duplicate_flagged", { matches: duplicates.map((d) => d.id) }, "system");
  }

  return { deal, property, duplicates };
}

// -- Offers ----------------------------------------------------------------

// The one place an offer gets recorded. Two callers: the Log-offer form, and
// LOI generation (which records the offer automatically -- an LOI at a price
// IS an offer at that price, and relying on someone to also remember the
// Log-offer button is how the old tracker's offer count drifted).
//
// Making an offer is also what makes a deal "Offered", so an early-stage deal
// advances here rather than in the caller.
export async function recordOffer(
  dealId: string,
  input: {
    price?: number | null;
    offeredAt?: string | null;
    notes?: string | null;
    source?: "manual" | "loi";
  },
  actor: string,
  // LOI generation is re-runnable (regenerate to fix a typo, download again);
  // dedupe stops each regeneration from inflating the offer count.
  opts: { dedupeSameDayPrice?: boolean } = {}
) {
  const supabase = getServiceClient();
  const offeredAt = input.offeredAt ?? new Date().toISOString().slice(0, 10);
  const price = input.price ?? null;
  const source = input.source ?? "manual";

  if (opts.dedupeSameDayPrice) {
    let dupQuery = supabase
      .from("offers")
      .select("id")
      .eq("deal_id", dealId)
      .eq("offered_at", offeredAt)
      .limit(1);
    dupQuery = price === null ? dupQuery.is("price", null) : dupQuery.eq("price", price);
    const { data: existing } = await dupQuery;
    if (existing && existing.length > 0) {
      return { offer: null as any, deduped: true, advanced: false };
    }
  }

  const { data: offer, error } = await supabase
    .from("offers")
    .insert({
      deal_id: dealId,
      offered_at: offeredAt,
      price,
      notes: input.notes ?? null,
      source,
      created_by: actor,
    })
    .select()
    .single();
  if (error) throw error;

  await logDealEvent(dealId, "offer_logged", { price, source }, actor);

  // Making an offer moves an early-stage acquisition to Offered.
  const { data: advanced } = await supabase
    .from("deals")
    .update({ stage: "offered" })
    .eq("id", dealId)
    .eq("deal_type", "acquisition")
    .in("stage", ["prospect", "uw"])
    .select("id, stage");
  const didAdvance = !!advanced && advanced.length > 0;
  if (didAdvance) {
    await logDealEvent(dealId, "marked_offered", { via: `offer_logged:${source}` }, "system");
    await fireStageChangeWebhook(dealId, { to: "offered", actor: "system", via: "offer_logged" });
  }

  return { offer, deduped: false, advanced: didAdvance };
}

// -- Contacts / duplicates -------------------------------------------------

// Exact-name match (case-insensitive) or create. Intake types a counterparty
// name; if that person/firm is already a contact we reuse them so their deal
// history accumulates on one record. New contacts get the classification the
// intake field implies (tenant/broker); null means "classify by hand".
async function findOrCreateContactByName(name: string, contactType: string | null = null): Promise<string> {
  const supabase = getServiceClient();
  const { data: existing } = await supabase
    .from("contacts")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ name, contact_type: contactType })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

export async function findDuplicateDeals(address: string, excludeDealId?: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id, address, deals(id, stage, death_stage, created_at)")
    .textSearch("address", address.split(" ").join(" & "))
    .neq("deals.id", excludeDealId ?? "");

  if (error) throw error;
  return (data ?? []).flatMap((p: any) => p.deals ?? []);
}

async function notifyMarketLeadForMla(dealId: string, address: string) {
  // No Graph/Mail.Send dependency -- this just logs the flag so it
  // shows up as "awaiting MLA" on the deal. You email the market lead
  // yourself, same as today; when they reply, key the numbers into
  // mla_data via the deal detail page.
  await logDealEvent(dealId, "mla_requested", { address }, "system");
}

export async function logDealEvent(
  dealId: string,
  eventType: string,
  detail: Record<string, unknown>,
  actor: string
) {
  const supabase = getServiceClient();
  const { error } = await supabase.from("deal_events").insert({
    deal_id: dealId,
    event_type: eventType,
    detail,
    actor,
  });
  if (error) throw error;
}
