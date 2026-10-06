// lib/deal-view.ts
//
// One shape for "a deal as the redesign shows it" -- the card on /deals, the
// column on /deals/compare, the pin on /map, the row on /ic. Built from a deal
// row (DEAL_CARD_SELECT) plus its signals, so every screen agrees on the
// price, basis, score and flags.

import { ASSET_CLASS_LABELS, STAGE_LABELS } from "./deals";
import { dealValue, VALUE_BASIS_LABELS } from "./summary";
import { resolveFlags, siteScore, type Flag, type SignalRow } from "./site-score";
import { acres, dealRef, fmtAcres, fmtMoney, fmtSf } from "./format";

export const DEAL_CARD_SELECT =
  "id, ref, stage, asset_class, created_at, asking_price, dd_end_on, closing_on, closed_on, closed_price, contract_price, ic_on, loi_response_due_on, mla_status, properties(address, city, market, submarket, latitude, longitude, geocode_precision, lot_sf, building_sf), offers(price, offered_at), deal_events(event_type, created_at)";

const DAY_MS = 86400000;

// Event types that mark a stage transition -- the newest one tells us when
// the deal entered its current stage.
const STAGE_EVENTS = new Set([
  "deal_created",
  "advanced_to_uw",
  "marked_offered",
  "confirmed_psa",
  "entered_due_diligence",
  "marked_closed",
  "stage_corrected",
  "restored",
]);

export function daysInStage(deal: any): number {
  const stamps = (deal.deal_events ?? [])
    .filter((e: any) => STAGE_EVENTS.has(e.event_type))
    .map((e: any) => e.created_at)
    .sort();
  const entered = stamps.pop() ?? deal.created_at;
  return Math.max(0, Math.floor((Date.now() - new Date(entered).getTime()) / DAY_MS));
}

export interface DealCardData {
  id: string;
  ref: string;
  name: string;
  city: string | null;
  market: string | null;
  assetClass: string;
  typeLabel: string;
  sizeLabel: string;
  price: number | null;
  priceLabel: string;
  priceBasis: string;
  basisValue: number | null;
  basisLabel: string;
  basisUnit: string;
  score: number | null;
  scoreCounts: ReturnType<typeof siteScore>["counts"];
  flags: Flag[];
  stage: string;
  stageLabel: string;
  days: number;
  createdAt: string;
  icOn: string | null;
  lat: number | null;
  lng: number | null;
  geocodePrecision: string | null;
  lotSf: number | null;
  buildingSf: number | null;
}

export function toDealCard(deal: any, signals: SignalRow[] | undefined): DealCardData {
  const p = deal.properties ?? {};
  const ios = deal.asset_class !== "industrial";
  const value = dealValue(deal);
  const ac = acres(p.lot_sf);
  const bsf = p.building_sf ? Number(p.building_sf) : null;
  // IOS is land, priced per acre; industrial is priced per building SF.
  // Before any offer, the seller's ask (from the OM) is the best figure to
  // show -- labelled as such, and never counted in pipeline value (`price`).
  const ask = deal.asking_price != null ? Number(deal.asking_price) : null;
  const shown = value.amount ?? ask;
  const basisValue = shown ? (ios ? (ac ? shown / ac : null) : bsf ? shown / bsf : null) : null;
  const flags = resolveFlags(signals);
  const s = siteScore(flags);
  return {
    id: deal.id,
    ref: dealRef(deal.ref),
    name: p.address ?? "Untitled deal",
    city: p.city ?? null,
    market: p.market ?? null,
    assetClass: deal.asset_class ?? "ios",
    typeLabel: ASSET_CLASS_LABELS[deal.asset_class] ?? "IOS",
    sizeLabel: ios ? fmtAcres(p.lot_sf) : fmtSf(bsf),
    price: value.amount,
    priceLabel: fmtMoney(shown),
    priceBasis: value.amount == null && ask ? "asking price" : VALUE_BASIS_LABELS[value.basis],
    basisValue,
    basisLabel: basisValue == null ? "—" : ios ? fmtMoney(basisValue) : `$${Math.round(basisValue)}`,
    basisUnit: ios ? "/ac" : "/SF",
    score: s.score,
    scoreCounts: s.counts,
    flags,
    stage: deal.stage,
    stageLabel: STAGE_LABELS[deal.stage] ?? deal.stage,
    days: daysInStage(deal),
    createdAt: deal.created_at,
    icOn: deal.ic_on ?? null,
    lat: p.latitude != null ? Number(p.latitude) : null,
    lng: p.longitude != null ? Number(p.longitude) : null,
    geocodePrecision: p.geocode_precision ?? null,
    lotSf: p.lot_sf != null ? Number(p.lot_sf) : null,
    buildingSf: bsf,
  };
}
