// lib/agents/tools.ts
//
// Hopper as a toolset for the agents. The helper's MCP bridge
// (scripts/outlook-helper/hopper-mcp.mjs) offers these to Codex mid-task, and
// app/api/agents/tools runs them -- only for a paired helper, only while it is
// working that job. Every tool is READ-ONLY: it looks things up and never
// changes a record.
//
//   geocode          address -> point and how precise it is
//   parcel_lookup    point -> owner of record, mailing address, acres, value (appraisal roll)
//   usable_acres     point -> parcel measured net of buildings, flood, wetlands, steep ground, narrow strips
//   comps_near       point -> confirmed lease / sale comps around it, nearest first, duplicates merged
//   hopper_nearby    point -> Hopper deals (any stage) and owned assets around it
//   deal_history     deal id -> stage, prices, offers, contacts, recent events and touches
//   search_hopper    words -> matching deals, contacts, companies and comps

import { getServiceClient } from "@/lib/supabase";
import { geocodeDetailed } from "@/lib/geocode";
import { lookupParcel } from "@/lib/sourcing/parcels";
import { measureUsableAcres } from "@/lib/sourcing/usable-acres";
import { readAllCompPages } from "@/lib/comps/mapData";
import { compsWithin, dedupeComps } from "@/lib/comps/radius";
import { haversineMiles } from "@/lib/comps/match";
import { rateViews } from "@/lib/comps/rates";
import { STAGE_LABELS } from "@/lib/deals";

type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
export type AgentTool = { name: string; description: string; inputSchema: Schema; run: (args: Record<string, unknown>) => Promise<unknown> };

const POINT = {
  lat: { type: "number", description: "Latitude (WGS84)." },
  lng: { type: "number", description: "Longitude (WGS84)." },
};
const UUID = /^[0-9a-f-]{36}$/i;

function point(a: Record<string, unknown>) {
  const lat = Number(a.lat), lng = Number(a.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) throw new Error("Give lat and lng as numbers (WGS84).");
  return { lat, lng };
}
const clamp = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const round = (n: number | null | undefined, dp = 2) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10 ** dp) / 10 ** dp);
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : null);

const COMP_COLUMNS =
  "id, comp_type, status, address, suite, project_name, city, state, market, submarket, asset_class, latitude, longitude, geocode_precision, is_portfolio, portfolio_transaction_id, created_at, " +
  "building_sf, lot_sf, yard_acres, rent, rent_basis, date_commenced, lease_term_months, lease_type, escalations_pct, tenant_name, sale_price, closed_on, cap_rate, buyer, seller";

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "geocode",
    description: "Find the map point for an address. Returns lat/lng, how precise the match is (rooftop, interpolated, approximate), and Google's formatted address.",
    inputSchema: { type: "object", properties: { address: { type: "string", description: "Street address with city and state." } }, required: ["address"], additionalProperties: false },
    async run(a) {
      const address = String(a.address ?? "").trim().slice(0, 300);
      if (!address) throw new Error("Give an address.");
      const g = await geocodeDetailed([address]);
      return g.result ? { lat: g.result.lat, lng: g.result.lng, precision: g.result.precision, formatted: g.result.formatted } : { found: false, reason: g.reason };
    },
  },
  {
    name: "parcel_lookup",
    description: "Owner of record for the parcel under a point, from the county appraisal roll: owner, care-of, mailing address, situs address, acres, year built, market value, parcel ID, county, tax year and owner class. Use this before naming an owner.",
    inputSchema: { type: "object", properties: POINT, required: ["lat", "lng"], additionalProperties: false },
    async run(a) {
      const { lat, lng } = point(a);
      const p = await lookupParcel(lat, lng);
      if (!p) return { found: false, reason: "No parcel returned for this point by the appraisal sources Hopper reads." };
      const { outline: _outline, ...rest } = p;
      return { found: true, ...rest };
    },
  },
  {
    name: "usable_acres",
    description: "Measure the parcel under a point: gross acres, and net usable acres after removing buildings, FEMA floodplain, wetlands, steep ground and strips too narrow to use; plus building footprint and coverage %. Slower (several seconds).",
    inputSchema: { type: "object", properties: POINT, required: ["lat", "lng"], additionalProperties: false },
    async run(a) {
      const { lat, lng } = point(a);
      const p = await lookupParcel(lat, lng);
      if (!p?.outline) return { measured: false, reason: "No parcel outline available for this point." };
      const u = await measureUsableAcres(p.outline, fetch, { terrain: true });
      return u ? { measured: true, parcelId: p.propId, county: p.county, ...u } : { measured: false, reason: "The measurement services did not answer." };
    },
  },
  {
    name: "comps_near",
    description: "Confirmed lease and/or sale comps in Hopper within a radius of a point, nearest first, duplicates merged. Leases include normalised $/acre/month and $/SF/month; sales include price, $/acre of land and $/SF of building.",
    inputSchema: { type: "object", properties: {
      ...POINT,
      miles: { type: "number", description: "Radius in miles, 0.5 to 25 (default 5)." },
      type: { type: "string", enum: ["lease", "sale", "both"], description: "Default both." },
      assetClass: { type: "string", enum: ["all", "ios", "industrial"], description: "Default all." },
      limit: { type: "number", description: "Most comps to return, 1 to 40 (default 20)." },
    }, required: ["lat", "lng"], additionalProperties: false },
    async run(a) {
      const center = point(a);
      const miles = clamp(a.miles, 0.5, 25, 5), limit = Math.round(clamp(a.limit, 1, 40, 20));
      const type = a.type === "lease" || a.type === "sale" ? a.type : "both";
      const assetClass = a.assetClass === "ios" || a.assetClass === "industrial" ? a.assetClass : "all";
      const db = getServiceClient();
      const comps = await readAllCompPages<any>((from, to) => db.from("comps").select(COMP_COLUMNS).eq("status", "confirmed").not("latitude", "is", null).order("id").range(from, to) as any);
      const found = dedupeComps(compsWithin(comps, center, miles, type, assetClass));
      return {
        radiusMiles: miles, total: found.length,
        comps: found.slice(0, limit).map((c: any) => {
          const base = { id: c.id, type: c.comp_type, miles: round(c.distanceMiles, 1), address: [c.address, c.suite ? `Ste ${c.suite}` : null].filter(Boolean).join(", "), city: c.city, submarket: c.submarket ?? c.market, assetClass: c.asset_class, buildingSf: c.building_sf, landAcres: round(c.lot_sf ? Number(c.lot_sf) / 43560 : null), yardAcres: c.yard_acres, mergedRecords: c.mergedFrom.length + 1 };
          if (c.comp_type === "lease") {
            const v = rateViews(c);
            return { ...base, commenced: day(c.date_commenced), tenant: c.tenant_name, termMonths: c.lease_term_months, leaseType: c.lease_type, perAcreMonthly: round(v.perAcreMonthly, 0), perSfMonthly: round(v.perSfBldgMonthly), totalMonthly: round(v.totalMonthly, 0), escalationsPct: c.escalations_pct };
          }
          const price = Number(c.sale_price) || null, bldg = Number(c.building_sf) || null, land = c.lot_sf ? Number(c.lot_sf) / 43560 : null;
          return { ...base, closed: day(c.closed_on), price, perAcreLand: price && land ? round(price / land, 0) : null, perSfBuilding: price && bldg ? round(price / bldg) : null, capRate: c.cap_rate, buyer: c.buyer, seller: c.seller };
        }),
      };
    },
  },
  {
    name: "hopper_nearby",
    description: "Hopper's own records around a point: deals in any stage (including archived, with why they died and the last offer) and owned assets (occupancy, acres). Use it to see whether a site is already known, and what Dalfen owns or has offered on nearby.",
    inputSchema: { type: "object", properties: { ...POINT, miles: { type: "number", description: "Radius in miles, 0.1 to 5 (default 1)." } }, required: ["lat", "lng"], additionalProperties: false },
    async run(a) {
      const center = point(a);
      const miles = clamp(a.miles, 0.1, 5, 1);
      const dLat = miles / 69, dLng = miles / (69 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)));
      const db = getServiceClient();
      const [deals, assets] = await Promise.all([
        db.from("deals").select("id, stage, death_stage, death_reason, marketing_status, asset_class, asking_price, created_at, properties!inner(address, city, latitude, longitude, lot_sf), offers(price, offered_at)")
          .eq("deal_type", "acquisition").gte("properties.latitude", center.lat - dLat).lte("properties.latitude", center.lat + dLat)
          .gte("properties.longitude", center.lng - dLng).lte("properties.longitude", center.lng + dLng).limit(200),
        db.from("assets").select("id, address, city, status, occupancy, site_acres, building_sf, latitude, longitude")
          .gte("latitude", center.lat - dLat).lte("latitude", center.lat + dLat).gte("longitude", center.lng - dLng).lte("longitude", center.lng + dLng).limit(200),
      ]);
      if (deals.error) throw deals.error;
      if (assets.error) throw assets.error;
      const dist = (lat: unknown, lng: unknown) => haversineMiles(center.lat, center.lng, Number(lat), Number(lng));
      return {
        radiusMiles: miles,
        deals: (deals.data ?? []).map((d: any) => ({ d, miles: dist(d.properties.latitude, d.properties.longitude) })).filter((x) => x.miles <= miles).sort((x, y) => x.miles - y.miles).slice(0, 25).map(({ d, miles: m }) => {
          const last = [...(d.offers ?? [])].sort((x: any, y: any) => String(y.offered_at).localeCompare(String(x.offered_at)))[0];
          return { id: d.id, miles: round(m, 2), address: d.properties.address, city: d.properties.city, stage: STAGE_LABELS[d.stage] ?? d.stage, diedAt: d.death_stage ? STAGE_LABELS[d.death_stage] ?? d.death_stage : null, deathReason: d.death_reason, marketing: d.marketing_status, assetClass: d.asset_class, askingPrice: d.asking_price, acres: round(d.properties.lot_sf ? Number(d.properties.lot_sf) / 43560 : null), lastOffer: last ? { price: last.price, on: last.offered_at } : null, added: day(d.created_at) };
        }),
        ownedAssets: (assets.data ?? []).map((x: any) => ({ x, miles: dist(x.latitude, x.longitude) })).filter((y) => y.miles <= miles).sort((p, q) => p.miles - q.miles).slice(0, 25).map(({ x, miles: m }) => ({ id: x.id, miles: round(m, 2), address: x.address, city: x.city, status: x.status, occupancy: x.occupancy, acres: x.site_acres, buildingSf: x.building_sf })),
      };
    },
  },
  {
    name: "deal_history",
    description: "One Hopper deal in detail: property, stage (or why it died), asking / contract / closed prices, offers, linked contacts by role, the latest events, and logged calls / emails / touches.",
    inputSchema: { type: "object", properties: { dealId: { type: "string", description: "The deal's id (from hopper_nearby or search_hopper)." } }, required: ["dealId"], additionalProperties: false },
    async run(a) {
      const id = String(a.dealId ?? "");
      if (!UUID.test(id)) throw new Error("Give a deal id.");
      const db = getServiceClient();
      const [deal, events, touches] = await Promise.all([
        db.from("deals").select("id, stage, death_stage, death_reason, disposition, marketing_status, acquisition_type, asset_class, asking_price, contract_price, closed_price, created_at, follow_up_on, properties(address, city, market, submarket, lot_sf, building_sf), offers(price, offered_at, status, counter_price), deal_contacts(role, contacts(name, companies(name)))").eq("id", id).maybeSingle(),
        db.from("deal_events").select("event_type, created_at, actor").eq("deal_id", id).order("created_at", { ascending: false }).limit(15),
        db.from("activities").select("activity_type, outcome, subject, occurred_at").eq("deal_id", id).order("occurred_at", { ascending: false }).limit(15),
      ]);
      if (deal.error) throw deal.error;
      if (!deal.data) return { found: false };
      const d: any = deal.data;
      return {
        found: true, id: d.id, address: d.properties?.address, city: d.properties?.city, market: d.properties?.market, submarket: d.properties?.submarket,
        acres: round(d.properties?.lot_sf ? Number(d.properties.lot_sf) / 43560 : null), buildingSf: d.properties?.building_sf,
        stage: STAGE_LABELS[d.stage] ?? d.stage, diedAt: d.death_stage ? STAGE_LABELS[d.death_stage] ?? d.death_stage : null, deathReason: d.death_reason, disposition: d.disposition,
        marketing: d.marketing_status, acquisitionType: d.acquisition_type, assetClass: d.asset_class,
        askingPrice: d.asking_price, contractPrice: d.contract_price, closedPrice: d.closed_price, added: day(d.created_at), followUpOn: d.follow_up_on,
        offers: (d.offers ?? []).sort((x: any, y: any) => String(y.offered_at).localeCompare(String(x.offered_at))).slice(0, 10),
        contacts: (d.deal_contacts ?? []).map((l: any) => ({ role: l.role, name: l.contacts?.name ?? null, company: l.contacts?.companies?.name ?? null })),
        recentEvents: (events.data ?? []).map((e: any) => ({ type: e.event_type, on: day(e.created_at) })),
        recentTouches: (touches.data ?? []).map((t: any) => ({ type: t.activity_type, outcome: t.outcome, subject: t.subject, on: day(t.occurred_at) })),
      };
    },
  },
  {
    name: "search_hopper",
    description: "Search Hopper by words (an address, owner, broker, tenant or company name). Returns the best matching deals, contacts, companies, logged notes and tasks, with ids.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look for (2 to 120 characters)." } }, required: ["query"], additionalProperties: false },
    async run(a) {
      const q = String(a.query ?? "").trim().slice(0, 120);
      if (q.length < 2) throw new Error("Give at least two characters to search for.");
      const { data, error } = await getServiceClient().rpc("global_search", { q });
      if (error) throw error;
      // global_search returns { deals, contacts, companies, notes, tasks }, each ranked.
      const groups = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      return Object.fromEntries(["deals", "contacts", "companies", "notes", "tasks"].map((k) => [k, Array.isArray(groups[k]) ? (groups[k] as unknown[]).slice(0, 10) : []]));
    },
  },
];

/** Longest tool result handed back to the model; the rest is cut with a note. */
export const TOOL_RESULT_LIMIT = 30000;

export function toolDefinitions() {
  return AGENT_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Runs one tool; errors come back as a result the model can read rather than a failure. */
export async function runTool(name: string, args: unknown): Promise<{ ok: boolean; text: string }> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, text: `Unknown tool ${name}.` };
  try {
    const out = await tool.run(args && typeof args === "object" ? (args as Record<string, unknown>) : {});
    let text = JSON.stringify(out);
    if (text.length > TOOL_RESULT_LIMIT) text = text.slice(0, TOOL_RESULT_LIMIT) + ` ... [cut at ${TOOL_RESULT_LIMIT} characters; narrow the request]`;
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, text: `Tool ${name} failed: ${e?.message ?? "unknown error"}` };
  }
}
