// lib/site-signals.ts
//
// SERVER ONLY. Computes the six site-viability flags from evidence Hopper can
// actually reach, and stores them in deal_signals (auto_* columns). A human
// override (override_* columns) always wins and is never touched here.
//
// Each rule says plainly what it measured in auto_note and where it came from
// in auto_source, because a red flag on an IC slide gets asked about. When the
// evidence isn't there the flag is 'unknown' -- never a guess.
//
//   demand  Google Places yard-user search (lib/demand-search), 5 mi snapshot
//   zoning  municipal zoning GIS (lib/zoning/research)
//   access  OpenStreetMap freeway exits (Overpass API)
//   site    FEMA National Flood Hazard Layer, sampled across the lot
//   basis   price vs confirmed sale comps within 10 mi / 36 months
//   rent    in-place rent vs confirmed lease comps (or the MLA market rent)

import { getServiceClient } from "./supabase";
import { searchNearby } from "./demand-search";
import { DEFAULT_CATEGORIES } from "./sourcing/yard-users";
import { haversineMiles } from "./ic-deck/geo";
import { rateViews } from "./comps/rates";
import { dealValue } from "./summary";
import { fmtMoney } from "./format";
import { researchZoning } from "./zoning/research";
import type { ZoningReport } from "./zoning/types";
import { scoreState, type FlagKey, type SignalState } from "./hopper-tokens";
import { demandBreakdown, type DemandSnapshot, type SignalRow } from "./site-score";

const SQFT_PER_ACRE = 43560;
const COMP_RADIUS_MI = 10;
const COMP_MAX_AGE_MONTHS = 36;
const MIN_COMPS = 3;
export const SNAPSHOT_RADIUS_MI = 5;

type Auto = { state: SignalState; note: string; source: string; detail?: unknown };

export const SIGNAL_COLUMNS =
  "deal_id, key, auto_state, auto_note, auto_source, auto_at, override_state, override_note, override_by, override_at";

/** Signals for many deals at once, without the (large) demand snapshot. */
export async function loadSignals(dealIds: string[]): Promise<Map<string, SignalRow[]>> {
  const out = new Map<string, SignalRow[]>();
  if (!dealIds.length) return out;
  const { data } = await getServiceClient().from("deal_signals").select(SIGNAL_COLUMNS).in("deal_id", dealIds);
  for (const row of (data ?? []) as any[]) {
    const list = out.get(row.deal_id) ?? [];
    list.push(row);
    out.set(row.deal_id, list);
  }
  return out;
}

export async function loadDemandSnapshot(dealId: string): Promise<DemandSnapshot | null> {
  const { data } = await getServiceClient()
    .from("deal_signals")
    .select("auto_detail")
    .eq("deal_id", dealId)
    .eq("key", "demand")
    .maybeSingle();
  const d = data?.auto_detail as DemandSnapshot | undefined;
  return d && Array.isArray(d.tenants) ? d : null;
}

async function saveAuto(dealId: string, key: FlagKey, a: Auto) {
  const { error } = await getServiceClient()
    .from("deal_signals")
    .upsert(
      {
        deal_id: dealId,
        key,
        auto_state: a.state,
        auto_note: a.note,
        auto_source: a.source,
        auto_detail: a.detail ?? null,
        auto_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,key" }
    );
  if (error) throw new Error(`Saving ${key} signal: ${error.message}`);
}

export async function setOverride(
  dealId: string,
  key: FlagKey,
  state: Exclude<SignalState, "unknown"> | null,
  note: string | null,
  by: string
) {
  const { error } = await getServiceClient()
    .from("deal_signals")
    .upsert(
      {
        deal_id: dealId,
        key,
        override_state: state,
        override_note: state ? note : null,
        override_by: state ? by : null,
        override_at: state ? new Date().toISOString() : null,
      },
      { onConflict: "deal_id,key" }
    );
  if (error) throw new Error(error.message);
}

// ---- helpers ----------------------------------------------------------------

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function monthsAgo(date: string): number {
  return (Date.now() - new Date(date).getTime()) / (30.44 * 86400000);
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 20000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---- demand -----------------------------------------------------------------

export async function computeDemand(point: { lat: number; lng: number }): Promise<Auto> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { state: "unknown", note: "Places search not configured", source: "Google Places" };
  // 20 is one page of Nearby Search -- effectively uncapped, so counts are real.
  const { tenants } = await searchNearby({
    ...point,
    radiusMiles: SNAPSHOT_RADIUS_MI,
    categories: DEFAULT_CATEGORIES,
    perCategoryCap: 20,
    apiKey: key,
  });
  const snapshot: DemandSnapshot = {
    center: point,
    radiusMiles: SNAPSHOT_RADIUS_MI,
    fetchedAt: new Date().toISOString(),
    tenants: tenants.map(({ name, category, lat, lng, placeId, distanceMi }) => ({
      name,
      category,
      lat,
      lng,
      placeId,
      distanceMi: Math.round(distanceMi * 100) / 100,
    })),
  };
  const { total, index } = demandBreakdown(snapshot, 3);
  return {
    state: scoreState(index),
    note: `${total} tenant-demand hits within 3 mi (index ${index})`,
    source: `Google Places yard-user search, ${SNAPSHOT_RADIUS_MI} mi`,
    detail: snapshot,
  };
}

// ---- zoning -----------------------------------------------------------------

export function zoningFromReport(report: ZoningReport): Auto {
  const z = report.subject;
  const where = report.municipality || "municipal GIS";
  if (!z || z.status === "unknown" || !z.district) {
    return { state: "unknown", note: "Parcel zoning not found in municipal GIS", source: where };
  }
  const label = [z.district, z.description].filter(Boolean).join(" â€” ");
  const peers = (report.candidates ?? []).filter(
    (c) => c.evidence?.outdoorUse && (c.match === "same_code" || c.match === "same_designation")
  );
  if (peers.length) {
    return {
      state: "strong",
      note: `${label}; ${peers.length} outdoor-storage user${peers.length === 1 ? "" : "s"} nearby in the same district`,
      source: `${where} zoning + neighbor evidence`,
    };
  }
  const extra = [z.specialUse && `SUP ${z.specialUse}`, z.plannedDevelopment && `PD ${z.plannedDevelopment}`, z.overlays?.length && `overlays: ${z.overlays.join(", ")}`]
    .filter(Boolean)
    .join("; ");
  return {
    state: "watch",
    note: `${label}${extra ? `; ${extra}` : ""}. Outdoor storage by right not yet confirmed`,
    source: `${where} zoning`,
  };
}

async function computeZoning(dealId: string, address: string, point: { lat: number; lng: number }, precision: string): Promise<Auto> {
  try {
    const report = await researchZoning({ dealId, address, point, precision, radiusMiles: 1 }, false);
    return zoningFromReport(report);
  } catch (e: any) {
    return { state: "unknown", note: e?.message ?? "Zoning lookup unavailable here", source: "Municipal zoning GIS" };
  }
}

// ---- truck access -----------------------------------------------------------

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export async function computeAccess(point: { lat: number; lng: number }): Promise<Auto> {
  const q = `[out:json][timeout:20];node(around:8047,${point.lat},${point.lng})[highway=motorway_junction];out body 200;`;
  // Public Overpass servers are often slow or 504; ask both and take whichever
  // answers first, inside the refresh route's time budget.
  {
    try {
      const data = await Promise.any(
        OVERPASS.map((url) =>
          fetchJson(
            url,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Hopper/1.0 (Dalfen Industrial deal tracker)",
                Accept: "application/json",
              },
              body: "data=" + encodeURIComponent(q),
            },
            40000
          )
        )
      );
      const exits = (data.elements ?? [])
        .map((e: any) => ({ d: haversineMiles(point.lat, point.lng, e.lat, e.lon), ref: e.tags?.ref as string | undefined }))
        .sort((a: any, b: any) => a.d - b.d);
      if (!exits.length) {
        return { state: "weak", note: "No freeway exit within 5 mi", source: "OpenStreetMap" };
      }
      const n = exits[0];
      const d = n.d.toFixed(1);
      const state: SignalState = n.d <= 1.5 ? "strong" : n.d <= 4 ? "watch" : "weak";
      return {
        state,
        note: `${d} mi (straight line) to nearest freeway exit${n.ref ? ` (Exit ${n.ref})` : ""}`,
        source: "OpenStreetMap motorway junctions",
      };
    } catch {
      // both servers failed
    }
  }
  return { state: "unknown", note: "Road network lookup unavailable; refresh to retry", source: "OpenStreetMap" };
}

// ---- site & flood -----------------------------------------------------------

const NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

export async function computeFlood(point: { lat: number; lng: number }, lotSf: number | null): Promise<Auto> {
  // We hold a point, not a parcel outline, so sample a disc of the lot's area:
  // the centre plus eight points at 70% of the equivalent radius.
  const samples = [point];
  if (lotSf && lotSf > 0) {
    const rMiles = (Math.sqrt(lotSf / Math.PI) * 0.7) / 5280;
    const dLat = rMiles / 69;
    const dLng = rMiles / (69 * Math.cos((point.lat * Math.PI) / 180));
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      samples.push({ lat: point.lat + Math.sin(a) * dLat, lng: point.lng + Math.cos(a) * dLng });
    }
  }
  try {
    // FEMA's server drops the odd connection (about 1 in 9 in testing), so
    // each point gets one retry and the read uses whichever points answered.
    const query = async (p: { lat: number; lng: number }) => {
      const u = new URL(NFHL);
      u.searchParams.set("geometry", `${p.lng},${p.lat}`);
      u.searchParams.set("geometryType", "esriGeometryPoint");
      u.searchParams.set("inSR", "4326");
      u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
      u.searchParams.set("outFields", "FLD_ZONE,SFHA_TF");
      u.searchParams.set("returnGeometry", "false");
      u.searchParams.set("f", "json");
      const d = await fetchJson(u.toString(), { headers: { "User-Agent": "Hopper/1.0 (Dalfen Industrial deal tracker)" } });
      if (d.error) throw new Error(d.error.message);
      const a = d.features?.[0]?.attributes;
      return a ? { zone: String(a.FLD_ZONE ?? ""), sfha: a.SFHA_TF === "T" } : null;
    };
    const settled = await Promise.allSettled(samples.map((p) => query(p).catch(() => query(p))));
    const answered = settled.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ zone: string; sfha: boolean } | null>[];
    if (answered.length < Math.ceil(samples.length / 2)) throw new Error("FEMA unavailable");
    const mapped = answered.map((r) => r.value).filter(Boolean) as { zone: string; sfha: boolean }[];
    if (!mapped.length) return { state: "unknown", note: "No FEMA flood map panel here", source: "FEMA NFHL" };
    const wet = mapped.filter((z) => z.sfha);
    const pct = Math.round((wet.length / mapped.length) * 100);
    const zonesSeen = [...new Set(wet.map((z) => z.zone))].join("/");
    if (!wet.length) {
      return { state: "strong", note: `Outside the 100-yr floodplain (Zone ${mapped[0].zone || "X"})`, source: "FEMA NFHL" };
    }
    const scope = samples.length > 1 ? `~${pct}% of site` : "Site centre";
    return {
      state: pct <= 25 && samples.length > 1 ? "watch" : "weak",
      note: `${scope} in 100-yr floodplain (Zone ${zonesSeen})`,
      source: samples.length > 1 ? `FEMA NFHL, ${samples.length} points across the lot` : "FEMA NFHL at the pin",
    };
  } catch {
    return { state: "unknown", note: "FEMA flood service unavailable; refresh to retry", source: "FEMA NFHL" };
  }
}

// ---- basis & rent -----------------------------------------------------------

type CompRow = {
  comp_type: string;
  latitude: number | null;
  longitude: number | null;
  sale_price: number | null;
  closed_on: string | null;
  date_commenced: string | null;
  lot_sf: number | null;
  yard_acres: number | null;
  building_sf: number | null;
  rent: number | null;
  rent_basis: string | null;
  asset_class: string | null;
};

function nearbyComps(comps: CompRow[], point: { lat: number; lng: number }, type: "sale" | "lease") {
  return comps.filter((c) => {
    if (c.comp_type !== type || c.latitude == null || c.longitude == null) return false;
    const when = type === "sale" ? c.closed_on : c.date_commenced;
    if (!when || monthsAgo(when) > COMP_MAX_AGE_MONTHS) return false;
    return haversineMiles(point.lat, point.lng, Number(c.latitude), Number(c.longitude)) <= COMP_RADIUS_MI;
  });
}

export function computeBasis(deal: any, comps: CompRow[], point: { lat: number; lng: number }): Auto {
  // Our number (close > contract > last offer) when there is one; before
  // that, the seller's ask from the OM, said so in the note.
  const ours = dealValue(deal).amount;
  const price = ours ?? (deal.asking_price != null ? Number(deal.asking_price) : null);
  const askNote = ours == null && price ? " ask" : "";
  const source = `Confirmed sale comps, ${COMP_RADIUS_MI} mi / ${COMP_MAX_AGE_MONTHS} mo`;
  if (!price) return { state: "unknown", note: "No price yet (ask, offer, contract or close)", source };
  const ios = deal.asset_class !== "industrial";
  const subjDen = ios ? Number(deal.properties?.lot_sf) / SQFT_PER_ACRE : Number(deal.properties?.building_sf);
  if (!(subjDen > 0)) return { state: "unknown", note: ios ? "Lot size missing" : "Building SF missing", source };
  const rates = nearbyComps(comps, point, "sale")
    .map((c) => {
      const den = ios
        ? Number(c.yard_acres) > 0 ? Number(c.yard_acres) : Number(c.lot_sf) / SQFT_PER_ACRE
        : Number(c.building_sf);
      return Number(c.sale_price) > 0 && den > 0 ? Number(c.sale_price) / den : null;
    })
    .filter((v): v is number => v != null);
  const unit = ios ? "/ac" : "/SF";
  const fmtRate = (v: number) => (ios ? fmtMoney(v) : `$${Math.round(v)}`) + unit;
  const subject = price / subjDen;
  if (rates.length < MIN_COMPS) {
    return { state: "unknown", note: `${fmtRate(subject)}${askNote}; only ${rates.length} sale comp${rates.length === 1 ? "" : "s"} nearby`, source };
  }
  const med = median(rates);
  const ratio = subject / med;
  const pct = (Math.abs(1 - ratio) * 100).toFixed(2);
  return {
    state: ratio <= 0.95 ? "strong" : ratio <= 1.1 ? "watch" : "weak",
    note: `${fmtRate(subject)}${askNote} vs ${fmtRate(med)} median of ${rates.length} sales (${pct}% ${ratio <= 1 ? "below" : "above"})`,
    source,
  };
}

export function computeRent(deal: any, comps: CompRow[], point: { lat: number; lng: number }, mlaMarketRent: number | null): Auto {
  const ios = deal.asset_class !== "industrial";
  const p = deal.properties ?? {};
  const pick = (v: ReturnType<typeof rateViews>) => (ios ? v.perAcreMonthly : v.perSfBldgMonthly);
  const fmt = (v: number) => (ios ? `$${Math.round(v).toLocaleString("en-US")}/ac/mo` : `$${v.toFixed(2)}/sf/mo`);

  const leaseRates = nearbyComps(comps, point, "lease")
    .map((c) => pick(rateViews(c)))
    .filter((v): v is number => v != null && v > 0);
  let market: number | null = null;
  let source = `Confirmed lease comps, ${COMP_RADIUS_MI} mi / ${COMP_MAX_AGE_MONTHS} mo`;
  if (leaseRates.length >= MIN_COMPS) market = median(leaseRates);
  else if (!ios && mlaMarketRent) {
    market = mlaMarketRent;
    source = "MLA market base rent";
  }

  const inPlace =
    deal.in_place_rent != null
      ? pick(rateViews({ rent: deal.in_place_rent, rent_basis: deal.in_place_rent_basis, building_sf: p.building_sf, lot_sf: p.lot_sf }))
      : null;

  if (!inPlace) {
    if (p.occupancy_status === "vacant") {
      return {
        state: "watch",
        note: market ? `Vacant; all lease-up at ~${fmt(market)} market` : "Vacant; rent is all lease-up",
        source,
      };
    }
    return { state: "unknown", note: "Enter in-place rent on the Financials tab", source };
  }
  if (!market) return { state: "unknown", note: `In-place ${fmt(inPlace)}; not enough lease comps for market`, source };
  const upside = market / inPlace - 1;
  return {
    state: upside >= 0.1 ? "strong" : upside >= -0.05 ? "watch" : "weak",
    note: `In-place ${fmt(inPlace)} vs market ${fmt(market)} (${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(2)}%)`,
    source,
  };
}

// ---- orchestration ----------------------------------------------------------

/**
 * Recompute every automatic flag for a deal. The demand search costs Google
 * Places calls, so it only runs when asked or when no snapshot exists yet.
 */
export async function refreshSignals(
  dealId: string,
  opts: { demand?: boolean; /** Never run the paid Places search (bulk backfills). */ skipDemand?: boolean } = {}
): Promise<string[]> {
  const supabase = getServiceClient();
  const { data: deal, error } = await supabase
    .from("deals")
    .select("id, asset_class, closed_price, contract_price, asking_price, in_place_rent, in_place_rent_basis, offers(price, offered_at), mla_data(market_base_rent), properties(address, latitude, longitude, geocode_precision, lot_sf, building_sf, occupancy_status)")
    .eq("id", dealId)
    .single();
  if (error || !deal) throw new Error("Deal not found");
  const p: any = deal.properties;
  const lat = p?.latitude != null ? Number(p.latitude) : null;
  const lng = p?.longitude != null ? Number(p.longitude) : null;
  const errors: string[] = [];
  const run = async (key: FlagKey, fn: () => Promise<Auto> | Auto) => {
    try {
      await saveAuto(dealId, key, await fn());
    } catch (e: any) {
      errors.push(`${key}: ${e?.message ?? e}`);
    }
  };

  if (lat == null || lng == null) {
    const none: Auto = { state: "unknown", note: "Set and verify the map pin first", source: "Location" };
    await Promise.all((["demand", "zoning", "access", "site", "basis", "rent"] as FlagKey[]).filter((k) => !(opts.skipDemand && k === "demand")).map((k) => run(k, () => none)));
    return errors;
  }
  const point = { lat, lng };

  const { data: comps } = await supabase
    .from("comps")
    .select("comp_type, latitude, longitude, sale_price, closed_on, date_commenced, lot_sf, yard_acres, building_sf, rent, rent_basis, asset_class")
    .eq("status", "confirmed")
    .not("latitude", "is", null)
    .limit(5000);
  const mla = (deal.mla_data as any[] | null)?.find((m) => m.market_base_rent != null)?.market_base_rent ?? null;

  const needDemand = !opts.skipDemand && (opts.demand || !(await loadDemandSnapshot(dealId)));
  await Promise.all([
    needDemand ? run("demand", () => computeDemand(point)) : Promise.resolve(),
    run("zoning", () => computeZoning(dealId, p.address ?? "", point, p.geocode_precision ?? "")),
    run("access", () => computeAccess(point)),
    run("site", () => computeFlood(point, p.lot_sf != null ? Number(p.lot_sf) : null)),
    run("basis", () => computeBasis(deal, (comps ?? []) as CompRow[], point)),
    run("rent", () => computeRent(deal, (comps ?? []) as CompRow[], point, mla != null ? Number(mla) : null)),
  ]);
  return errors;
}

/** Persist a richer zoning result (with neighbor evidence) from the zoning panel. */
export async function saveZoningSignal(dealId: string, report: ZoningReport) {
  await saveAuto(dealId, "zoning", zoningFromReport(report));
}
