// lib/site-score.ts
//
// Turns the six stored viability flags (deal_signals) into what every screen
// shows: a resolved flag list in the fixed order, a 0-100 site score, and the
// reviewed business counts. Pure -- no database access -- so the deal cards, the summary,
// the compare view and the .pptx slide all compute identically.
//
// The rules that produce each flag live in lib/site-signals.ts; this file only
// combines them. Nearby business counts have no automatic demand grade.

import {
  DEMAND_CATEGORIES,
  FLAG_KEYS,
  FLAG_META,
  scoreState,
  type FlagKey,
  type SignalState,
} from "./hopper-tokens";

export interface SignalRow {
  key: string;
  auto_state: SignalState | null;
  auto_note: string | null;
  auto_source: string | null;
  auto_detail?: any;
  auto_at: string | null;
  override_state: Exclude<SignalState, "unknown"> | null;
  override_note: string | null;
  override_by: string | null;
  override_at: string | null;
}

export interface Flag {
  key: FlagKey;
  label: string;
  short: string;
  state: SignalState;
  note: string;
  source: string | null;
  overridden: boolean;
  /** When the auto value was computed (or the override made). */
  at: string | null;
  autoState: SignalState;
  autoNote: string | null;
}

// Zoning and demand decide whether an IOS site works at all; rent upside is
// the softest of the six because it's often a single broker-quoted number.
export const FLAG_WEIGHTS: Record<FlagKey, number> = {
  demand: 1.5,
  zoning: 1.5,
  access: 1,
  site: 1,
  basis: 1,
  rent: 0.75,
};
const STATE_POINTS: Record<Exclude<SignalState, "unknown">, number> = { strong: 100, watch: 60, weak: 20 };
/** Below this many known flags the score is withheld rather than guessed. */
export const MIN_KNOWN_FLAGS = 3;

export function resolveFlags(rows: SignalRow[] | null | undefined): Flag[] {
  const byKey = new Map((rows ?? []).map((r) => [r.key, r]));
  return FLAG_KEYS.map((key) => {
    const r = byKey.get(key);
    const autoState: SignalState = key === "demand" ? "unknown" : r?.auto_state ?? "unknown";
    const overridden = !!r?.override_state;
    return {
      key,
      label: FLAG_META[key].label,
      short: FLAG_META[key].short,
      state: overridden ? r!.override_state! : autoState,
      note: overridden
        ? r!.override_note || `Set by ${r!.override_by ?? "a teammate"}`
        : key === "demand" ? "Nearby businesses are context; verify active requirements and site fit separately" : r?.auto_note || "Not assessed yet",
      source: overridden ? `Override · ${r!.override_by ?? ""}` : key === "demand" ? "Reviewed business map (context only)" : r?.auto_source ?? null,
      overridden,
      at: overridden ? r!.override_at : r?.auto_at ?? null,
      autoState,
      autoNote: key === "demand" ? "Business proximity does not establish leasing demand" : r?.auto_note ?? null,
    };
  });
}

/** Cached automatic signals cannot outlive their reviewed source context. */
export function resolveDecisionFlags(rows: SignalRow[] | null | undefined, deal:any): Flag[] {
 const reviewAt=[deal.investment_review?.updatedAt,...(deal.deal_analysis_versions??[]).filter((v:any)=>v.kind==="comps").map((v:any)=>v.created_at)].filter(Boolean).sort().at(-1);
 return resolveFlags(rows).map(f=>{
  if(f.overridden||!["rent","basis"].includes(f.key))return f;
  if(reviewAt&&(!f.at||f.at<reviewAt))return {...f,state:"unknown",note:"Source review changed; cached flag is stale. Open Financials for current evidence.",source:"Stale automatic assessment"};
  if(f.key==="rent") {
   const p=Array.isArray(deal.properties)?deal.properties[0]:deal.properties;
   if(p?.occupancy_status==="vacant")return {...f,state:"watch",note:"Vacant; income is all lease-up, not current in-place rent"};
   const r=deal.investment_review;
   if(r?.incomeStatus!=="in_place"||!r.incomeSource||!r.incomeSourceDate||!r.incomeEffectiveDate||r.incomeEffectiveDate>new Date().toISOString().slice(0,10))return {...f,state:"unknown",note:"Current in-place income evidence is unverified"};
  }
  return f;
 });
}

export interface SiteScore {
  score: number | null;
  state: SignalState;
  counts: Record<SignalState, number>;
}

export function siteScore(flags: Flag[]): SiteScore {
  const counts: Record<SignalState, number> = { strong: 0, watch: 0, weak: 0, unknown: 0 };
  let num = 0;
  let den = 0;
  for (const f of flags) {
    counts[f.state]++;
    if (f.state === "unknown") continue;
    num += STATE_POINTS[f.state] * FLAG_WEIGHTS[f.key];
    den += FLAG_WEIGHTS[f.key];
  }
  const known = flags.length - counts.unknown;
  const score = known >= MIN_KNOWN_FLAGS && den > 0 ? Math.round(num / den) : null;
  return { score, state: scoreState(score), counts };
}

export function scoreSummary(s: SiteScore): string {
  const parts = [`${s.counts.strong} green`, `${s.counts.watch} watch`, `${s.counts.weak} red`];
  if (s.counts.unknown) parts.push(`${s.counts.unknown} open`);
  return parts.join(", ");
}

// ---- Demand ---------------------------------------------------------------

/** A tenant as stored in the demand snapshot (no logos -- they're for slides). */
export interface DemandHit {
  name: string;
  category: string;
  lat: number;
  lng: number;
  placeId: string;
  distanceMi: number;
}

export interface DemandSnapshot {
  center: { lat: number; lng: number };
  radiusMiles: number;
  fetchedAt: string;
  tenants: DemandHit[];
}

/** Retired: a business count cannot establish leasing demand. Kept for old callers. */
export function demandIndex(_hits: number, _radius: number): null { return null; }

export interface CategoryRow {
  label: string;
  key: string;
  icon: string;
  color: string;
  count: number;
  /** 0-1 share of the busiest category, for bar widths. */
  share: number;
  state: SignalState;
}

/** Counts per category inside `radius`, honouring which categories are on. */
export function demandBreakdown(
  snap: DemandSnapshot | null | undefined,
  radius: number,
  activeKeys?: string[] | null
): { rows: CategoryRow[]; total: number; index: number | null } {
  const active = new Set(activeKeys ?? DEMAND_CATEGORIES.map((c) => c.key));
  const counts = DEMAND_CATEGORIES.map(
    (c) => (snap?.tenants ?? []).filter((t) => t.category === c.label && t.distanceMi <= radius).length
  );
  const max = Math.max(1, ...counts);
  const rows = DEMAND_CATEGORIES.map((c, i) => {

    return {
      ...c,
      count: counts[i],
      share: counts[i] / max,
      state: "unknown" as SignalState,
    };
  });
  const total = rows.reduce((a, r) => a + (active.has(r.key) ? r.count : 0), 0);
  return { rows, total, index: null };
}

/** ?r=1|3|5&cats=truck,equip|none -> radius (default 3) and active category keys. */
export function parseMapView(sp: { r?: string; cats?: string }): { radius: number; cats: string[] | null } {
  const r = Number(sp.r);
  return {
    radius: [1, 3, 5].includes(r) ? r : 3,
    cats: sp.cats === "none" ? [] : parseCats(sp.cats),
  };
}

export function parseCats(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const keys = raw.split(",").map((s) => s.trim()).filter((k) => DEMAND_CATEGORIES.some((c) => c.key === k));
  return keys.length ? keys : null;
}
