// lib/uw-screen.ts
//
// Everything the deal's Underwriting tab starts from: the deal's facts, the
// latest Excel model's snapshot, the comps for its market, and the screening
// inputs built from them (lib/uw/deal-inputs). Also used when a run is saved,
// so the frozen comp set is the server's, not the browser's.

import { getServiceClient } from "./supabase";
import { canonicalMarket, stateOfMarket } from "./markets";
import { annualInPlaceRent } from "./asset-performance";
import { dealValue, VALUE_BASIS_LABELS } from "./summary";
import { loadUwComps } from "./uw-comps";
import { buildDealInputs, compContext, type CompContext, type DealFacts, type DealUwBuild } from "./uw/deal-inputs";
import type { UwModelSnapshot } from "./uw/model-snapshot";

const AC = 43560;

export interface ScreenModel {
  versionId: string;
  versionNumber: number;
  snapshot: UwModelSnapshot;
}

export function dealFacts(deal: any, today: string): DealFacts {
  const p = (Array.isArray(deal.properties) ? deal.properties[0] : deal.properties) ?? {};
  const market = canonicalMarket(p.market, p.city);
  const lot = p.lot_sf != null ? Number(p.lot_sf) : null;
  const value = dealValue(deal);
  const ask = deal.asking_price != null ? Number(deal.asking_price) : null;
  const price = value.amount ?? ask;
  return {
    property: p.address ?? "(no address)",
    market,
    state: stateOfMarket(market) ?? (typeof p.state === "string" ? p.state.toUpperCase() : null),
    acres: lot && lot > 0 ? Math.round((lot / AC) * 100) / 100 : null,
    occupancy: p.occupancy_status === "vacant" || p.occupancy_status === "occupied" ? p.occupancy_status : null,
    price,
    priceLabel: value.amount != null ? `Deal ${VALUE_BASIS_LABELS[value.basis]}` : ask ? "Asking price" : "No price",
    inPlaceRentAnnual: annualInPlaceRent(deal.in_place_rent, deal.in_place_rent_basis, p.lot_sf, p.building_sf),
    exitCap: deal.exit_cap_rate != null && Number(deal.exit_cap_rate) > 0 ? Number(deal.exit_cap_rate) : null,
    today,
  };
}

/** The latest model version whose upload produced a snapshot. */
export function latestModel(deal: any): ScreenModel | null {
  const versions = [...(deal.uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number);
  const latest = versions[0];
  const snap = latest?.model_detail?.uw;
  return snap && Array.isArray(snap.rentRoll) ? { versionId: latest.id, versionNumber: latest.version_number, snapshot: snap as UwModelSnapshot } : null;
}

export async function screenFor(deal: any, today = new Date().toISOString().slice(0, 10)): Promise<{
  facts: DealFacts;
  model: ScreenModel | null;
  /** True when there are model versions but the latest has no snapshot yet (uploaded before the backfill). */
  modelPending: boolean;
  comps: CompContext;
  build: DealUwBuild;
}> {
  const facts = dealFacts(deal, today);
  const model = latestModel(deal);
  const comps = compContext(await loadUwComps(), facts.market, facts.acres, today);
  return {
    facts,
    model,
    modelPending: !model && (deal.uw_versions ?? []).length > 0,
    comps,
    build: buildDealInputs(facts, model?.snapshot ?? null, comps),
  };
}

export interface SavedRunRow {
  id: string;
  label: string | null;
  scenario: string;
  created_by: string;
  created_at: string;
  uw_version_id: string | null;
  inputs: unknown;
  sources?: Record<string, { source: string; note: string }>;
  results: { returns?: { unleveredIrr: number | null; leveredIrr: number | null; solvedPrice: number; year1Noi: number } } | null;
}

export async function listRuns(dealId: string): Promise<SavedRunRow[]> {
  const { data, error } = await getServiceClient()
    .from("uw_runs")
    .select("id, label, scenario, created_by, created_at, uw_version_id, inputs, sources, results")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(50);
  // The table arrives with its migration; until then the tab still works.
  if (error) return [];
  return (data ?? []) as SavedRunRow[];
}
