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
import { incomePosition, modelIdentity, latestVersion } from "./investment-review";
import { compReview } from "./comps/reviewed-evidence";
import { subjectOf } from "./comps/evidence";

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
    inPlaceRentAnnual: incomePosition(deal).current ? annualInPlaceRent(deal.in_place_rent, deal.in_place_rent_basis, p.lot_sf, p.building_sf) : null,
    exitCap: deal.exit_cap_rate != null && Number(deal.exit_cap_rate) > 0 ? Number(deal.exit_cap_rate) : null,
    today,
  };
}

/** The latest model version whose upload produced a snapshot. */
export function latestModel(deal: any): ScreenModel | null {
  const versions = [...(deal.uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number);
  const latest = latestVersion(deal);
  if (!modelIdentity(deal,latest).authoritative) return null;
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
  evidenceRows: Awaited<ReturnType<typeof loadUwComps>>;
}> {
  const facts = dealFacts(deal, today);
  const model = latestModel(deal);
  const review=compReview(deal,await loadUwComps() as any,subjectOf(deal));
  const evidenceRows = review.comps as Awaited<ReturnType<typeof loadUwComps>>;
  const comps = compContext(evidenceRows, facts.market, facts.acres, today,36,deal.asset_class ?? null);
  comps.reviewVersion=review.saved?.version??0;
  comps.messages.push(review.label);
  return {
    facts,
    model,
    modelPending: !model && (deal.uw_versions ?? []).length > 0 && modelIdentity(deal).authoritative,
    comps,
    build: incomeAwareBuild(deal, buildDealInputs(facts, model?.snapshot ?? null, comps)),
    evidenceRows,
  };
}

export function incomeAwareBuild(deal: any, build: DealUwBuild): DealUwBuild {
  const position=incomePosition(deal);
  if (!position.current) {
    build.inputs.rentRoll=build.inputs.rentRoll.map(t=>({...t,status:"Pipeline"}));
    build.warnings.push(position.label+". Modeled rent is a proposed screening case; confirm commencement and carrying expenses. Status alone does not invent a delay.");
  }
  const identity=modelIdentity(deal);
  if (!identity.authoritative && identity.state!=="missing") build.warnings.push("Workbook excluded pending source identity review: "+identity.issues.join("; "));
  return build;
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
  comp_snapshot?: CompContext;
  results: { returns?: { unleveredIrr: number | null; leveredIrr: number | null; solvedPrice: number; year1Noi: number } } | null;
}

export async function listRuns(dealId: string): Promise<SavedRunRow[]> {
  const { data, error } = await getServiceClient()
    .from("uw_runs")
    .select("id, label, scenario, created_by, created_at, uw_version_id, inputs, sources, results, comp_snapshot")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Saved underwriting runs could not be loaded: ${error.message}`);
  return (data ?? []) as SavedRunRow[];
}
