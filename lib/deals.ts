// lib/deals.ts
//
// createDeal() is the single entry point for getting a deal into the
// system. The New Deal form calls this today. When the shared inbox
// (acquisitions@dalfen.com) exists later, an email-triggered intake
// agent becomes a second caller of this same function — no schema or
// workflow changes required at that point.

import { getServiceClient } from "./supabase";

export type MlaStatus = "pending" | "requested" | "provided" | "assumed";

export interface NewDealInput {
  address: string;
  market?: string;
  submarket?: string;
  assetType: "ios" | "industrial" | "flex" | "other";
  lotSf?: number;
  buildingSf?: number;
  sourceBrokerId?: string;
  dealType?: "acquisition" | "lease";
  createdBy: string; // who's entering this (Rhett, market lead, or later: "email-intake")
  mla:
    | { status: "provided"; askingRent: number; opex?: number; otherAssumptions?: Record<string, unknown> }
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
      asset_type: input.assetType,
      lot_sf: input.lotSf ?? null,
      building_sf: input.buildingSf ?? null,
    })
    .select()
    .single();

  if (propError) throw propError;

  // MLA present or assumptions chosen -> straight to UW.
  // MLA requested -> deal still lands in UW (analyst can start working
  // other parts of the deal) but mla_status stays "requested" until
  // someone manually enters the reply.
  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .insert({
      property_id: property.id,
      deal_type: input.dealType ?? "acquisition",
      stage: "uw",
      source_broker_id: input.sourceBrokerId ?? null,
      mla_status: input.mla.status,
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (dealError) throw dealError;

  if (input.mla.status === "provided") {
    const { error: mlaError } = await supabase.from("mla_data").insert({
      deal_id: deal.id,
      asking_rent: input.mla.askingRent,
      opex: input.mla.opex ?? null,
      other_assumptions: input.mla.otherAssumptions ?? {},
      provided_by: input.createdBy,
      provided_at: new Date().toISOString(),
    });
    if (mlaError) throw mlaError;
  }

  if (input.mla.status === "requested") {
    await notifyMarketLeadForMla(deal.id, input.address);
  }

  await logDealEvent(deal.id, "deal_created", { mla_status: input.mla.status }, input.createdBy);

  // Duplicate detection: check address history now that the deal exists.
  const duplicates = await findDuplicateDeals(input.address, deal.id);
  if (duplicates.length > 0) {
    await logDealEvent(deal.id, "duplicate_flagged", { matches: duplicates.map((d) => d.id) }, "system");
  }

  return { deal, property, duplicates };
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
  // Sends via the requester's own mailbox (delegated Graph permission) --
  // deliberately not the shared inbox, since that doesn't exist yet.
  // See lib/graph.ts for the actual Graph sendMail call.
  await logDealEvent(dealId, "mla_requested", { address }, "system");
  // TODO: wire up lib/graph.ts sendMail() once Graph app registration is approved.
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
