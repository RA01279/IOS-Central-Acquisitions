// lib/deals.ts
//
// createDeal() is the single entry point for getting a deal into the
// system. The New Deal form calls this today. When the shared inbox
// (acquisitions@dalfen.com) exists later, an email-triggered intake
// agent becomes a second caller of this same function — no schema or
// workflow changes required at that point.

import { getServiceClient } from "./supabase";

export type MlaStatus = "pending" | "requested" | "provided" | "assumed";
export type DealType = "acquisition" | "lease";

// Ordered pipeline stages per deal type (excludes the shared 'archived'
// terminal). Keep these in sync with the deals_stage_for_type DB constraint
// in 0004_crm_leasing.sql. The leasing board and LeaseStageActions both read
// LEASE_STAGES so there's a single source of truth for order and labels.
// Acquisitions: deals enter at Prospect and move to UW only when a model
// (underwriting Excel) is uploaded -- see the versions route. UW v1 was
// retired when Prospect took over the "no model yet" role; it survives only
// in STAGE_LABELS so old events/archived deals still render.
export const ACQUISITION_STAGES = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence"] as const;
export const LEASE_STAGES = ["prospect", "tour", "proposal", "negotiation", "executed"] as const;

export const STAGE_LABELS: Record<string, string> = {
  uw: "UW",
  uw_v1: "UW v1", // legacy -- display only
  offered: "Offered",
  moving_to_psa: "Moving to PSA",
  due_diligence: "Due Diligence",
  prospect: "Prospect",
  tour: "Tour",
  proposal: "Proposal (LOI)",
  negotiation: "Negotiation",
  executed: "Executed",
  archived: "Archived",
};

// Opening stage per pipeline. Enforced in the DB by deals_stage_for_type
// (see 0004_crm_leasing.sql) -- keep these in sync with that constraint.
export const OPENING_STAGE: Record<DealType, string> = {
  acquisition: "prospect",
  lease: "prospect",
};

// The next stage forward in the leasing pipeline, or null if already at the
// last stage ('executed'). Used to render the single "advance" button.
export function nextLeaseStage(stage: string): string | null {
  const idx = LEASE_STAGES.indexOf(stage as (typeof LEASE_STAGES)[number]);
  if (idx === -1 || idx === LEASE_STAGES.length - 1) return null;
  return LEASE_STAGES[idx + 1];
}

// Guard for the API: is `to` a legal leasing stage to move to? We allow moving
// to any leasing stage (forward or back a step for corrections), but never
// outside the leasing set -- 'archived' goes through the archive route.
export function isValidLeaseStage(stage: string): boolean {
  return (LEASE_STAGES as readonly string[]).includes(stage);
}

export interface NewDealInput {
  address: string;
  market?: string;
  submarket?: string;
  city?: string;
  assetType: "ios" | "industrial" | "flex" | "other";
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
  // Leases: tenantName, landlordRepName (listing broker), tenantRepName.
  // Acquisitions: currentOwnerName (seller), buyerBrokerName, sellerBrokerName.
  tenantName?: string;
  landlordRepName?: string;
  tenantRepName?: string;
  currentOwnerName?: string;
  buyerBrokerName?: string;
  sellerBrokerName?: string;
  sourceBrokerId?: string;
  dealType?: DealType;
  createdBy: string; // who's entering this (Rhett, market lead, or later: "email-intake")
  // MLA is an acquisitions-underwriting concept. Optional so leasing deals,
  // which don't underwrite an MLA, can be created without one. The "provided"
  // variant carries the full "MLA - Base Case" field set (0003 schema) so
  // intake matches the later provide-MLA step -- every field optional so a
  // partial MLA can still be entered.
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
  const dealType: DealType = input.dealType ?? "acquisition";

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

  // Acquisitions open in UW; leases open in the leasing pipeline (prospect).
  // MLA status only applies to acquisitions -- leases default to "assumed"
  // (i.e. n/a) so the column stays valid without implying a pending request.
  const mlaStatus: MlaStatus = input.mla?.status ?? "assumed";

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .insert({
      property_id: property.id,
      deal_type: dealType,
      stage: OPENING_STAGE[dealType],
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
  const counterparties =
    dealType === "lease"
      ? [
          { name: input.tenantName, role: "tenant" },
          { name: input.landlordRepName, role: "listing_broker" },
          { name: input.tenantRepName, role: "tenant_broker" },
        ]
      : [
          { name: input.currentOwnerName, role: "seller" },
          { name: input.buyerBrokerName, role: "buyer_broker" },
          { name: input.sellerBrokerName, role: "seller_broker" },
        ];
  for (const cp of counterparties) {
    if (!cp.name?.trim()) continue;
    const contactId = await findOrCreateContactByName(cp.name.trim());
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

  await logDealEvent(deal.id, "deal_created", { deal_type: dealType, mla_status: mlaStatus }, input.createdBy);

  // Duplicate detection: check address history now that the deal exists.
  const duplicates = await findDuplicateDeals(input.address, deal.id);
  if (duplicates.length > 0) {
    await logDealEvent(deal.id, "duplicate_flagged", { matches: duplicates.map((d) => d.id) }, "system");
  }

  return { deal, property, duplicates };
}

// Exact-name match (case-insensitive) or create. Intake types a counterparty
// name; if that person/firm is already a contact we reuse them so their deal
// history accumulates on one record.
async function findOrCreateContactByName(name: string): Promise<string> {
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
    .insert({ name })
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
