// lib/sourcing/holding.ts
//
// What surrounds a sweep site's parcel, from the same appraisal roll:
//   * the owner's whole holding -- a yard is often several adjoining tax
//     parcels under one owner (1795 109th St, Grand Prairie: a 0.85-acre
//     parcel next to the same trust's 2.87 acres), so one small parcel never
//     rules a site out by itself;
//   * whether it sits among houses -- a business registered at a home
//     (2230 Ravenwood Dr: a fence company at a 0.19-acre owner-occupied lot
//     between four house lots) is not an IOS site. A business next door rules
//     that out: 2427 NW Dallas St is a person's 0.46 acres with his drywall
//     supply on it, between a pump service and a sealant company.
// lookupHolding does the queries; assessHolding is pure.

import { COUNTY_SOURCES, TEXAS_PARCEL_LAYER, type Parcel } from "./parcels";

/** A parcel touching the site's parcel. One tax parcel can carry several accounts (business personal property), hence owners[]. */
export interface Neighbour { propId: string; owners: string[]; mailing: string[]; situs: string | null; acres: number | null; outline: number[][][] | null }

export interface Holding {
  /** Site parcel plus adjoining parcels with the same owner. */
  acres: number | null;
  parcels: { propId: string; acres: number | null; situs: string | null }[];
  /** Adjoining parcels with a different owner. */
  neighbours: number;
  /** Of those, house-sized lots (under 0.35 acre, one account on the roll). */
  houseLots: number;
  /** Of those, parcels carrying a business: several accounts on the roll (business personal property), or 0.6 acre and up under a company. */
  businessLots: number;
  /** False when the lookup failed or hit its result cap; then nothing is concluded from the neighbours. */
  complete: boolean;
}

const RESULT_CAP = 20;
const SQM_PER_ACRE = 4046.8564224;
const clean = (v: unknown) => { const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : null; return s && s.toLowerCase() !== "null" ? s : null; };
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(clean(v)); return Number.isFinite(n) && n > 0 ? n : null; };

const ENTITY = /\b(L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|L\.?P|LTD|LLP|PARTNERS|PARTNERSHIP|HOLDINGS?|INVESTMENTS?|ENTERPRISES|PROPERTIES|PROPERTY|GROUP|ASSOCIATES|ASSN|BANK|CHURCH|MINISTRIES|ISD|CITY|COUNTY|STATE|AUTHORITY|DISTRICT|FUND|CAPITAL|REALTY|DEVELOPMENT|INDUSTRIES|INDUSTRIAL|SERVICES|SUPPLY|LOGISTICS|VENTURES|MANAGEMENT|OWNER|TR|ESTATE OF)\b|&\s*$/i;
const PERSONAL_TRUST = /\b(FAMILY|LIVING|REVOCABLE|IRREVOCABLE) TRUST\b/i;

/** "VELASQUEZ BARBARA", "KEVIN & BRANDI WILLETT", "SMITH FAMILY LIVING TRUST" -- not a company. */
export function individualOwner(owner: string | null | undefined): boolean {
  if (!owner || ENTITY.test(owner)) return false;
  return PERSONAL_TRUST.test(owner) || !/\bTRUST\b/i.test(owner);
}

const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);
/** House number and street name: "1304 E PACIFIC AVE" and "1304 E PACIFIC ST" are the same place on a roll. */
export function streetKey(address: string | null | undefined): string | null {
  const parts = (address ?? "").split(",")[0].toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/);
  if (!/^\d+[a-z]?$/.test(parts[0] ?? "")) return null;
  const name = parts.slice(1).find((t) => !DIRECTIONS.has(t));
  return name ? `${parts[0]} ${name}` : null;
}

/** The owner gets their tax mail at the property. */
export function ownerOccupied(p: { mailingAddress?: string | null; situsAddress?: string | null } | null | undefined): boolean {
  const a = streetKey(p?.mailingAddress), b = streetKey(p?.situsAddress);
  return !!a && a === b;
}

const ownerKey = (o: string) => o.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Same owner of record: identical names, one truncated from the other ("GRAND PRAIRIE FEED &"), or the same company mailing address. */
function sameOwner(parcel: Parcel, n: Neighbour): boolean {
  const own = parcel.owner ? ownerKey(parcel.owner) : null;
  if (own && own.length >= 6 && n.owners.some((o) => { const k = ownerKey(o); return k === own || (k.length >= 8 && own.startsWith(k)) || (own.length >= 8 && k.startsWith(own)); })) return true;
  // A shared mailing address joins entities of one owner (an operator's office),
  // but never homes: neighbours who each live at their own house are not one owner.
  const mail = streetKey(parcel.mailingAddress);
  return !!mail && !ownerOccupied(parcel) && n.mailing.some((m) => streetKey(m) === mail);
}

export function assessHolding(parcel: Parcel, found: Neighbour[], complete: boolean): Holding {
  const others = found.filter((n) => n.propId !== parcel.propId);
  const mine = others.filter((n) => sameOwner(parcel, n));
  const rest = others.filter((n) => !mine.includes(n));
  const isBusiness = (n: Neighbour) => n.owners.length > 1 || (n.acres != null && n.acres >= 0.6 && !n.owners.every(individualOwner));
  const isHouseLot = (n: Neighbour) => !isBusiness(n) && n.acres != null && n.acres < 0.35;
  const acres = parcel.acres == null ? null : Math.round((parcel.acres + mine.reduce((t, n) => t + (n.acres ?? 0), 0)) * 100) / 100;
  return {
    acres,
    parcels: [{ propId: parcel.propId ?? "", acres: parcel.acres, situs: parcel.situsAddress }, ...mine.map((n) => ({ propId: n.propId, acres: n.acres, situs: n.situs }))],
    neighbours: rest.length,
    houseLots: rest.filter(isHouseLot).length,
    businessLots: rest.filter(isBusiness).length,
    complete,
  };
}

function group(rows: { propId: string | null; owner: string | null; mailing: string | null; situs: string | null; acres: number | null; outline: number[][][] | null }[]): Neighbour[] {
  const by = new Map<string, Neighbour>();
  for (const r of rows) {
    if (!r.propId) continue;
    const n = by.get(r.propId) ?? { propId: r.propId, owners: [], mailing: [], situs: r.situs, acres: r.acres, outline: r.outline };
    if (r.owner && !n.owners.includes(r.owner)) n.owners.push(r.owner);
    if (r.mailing && !n.mailing.includes(r.mailing)) n.mailing.push(r.mailing);
    n.acres ??= r.acres; n.situs ??= r.situs; n.outline ??= r.outline;
    by.set(r.propId, n);
  }
  return [...by.values()];
}

const bbox = (rings: number[][][]) => {
  const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Parcels touching the site's parcel, from the roll the parcel came from. */
export async function lookupNeighbours(parcel: Parcel, fetcher: typeof fetch = fetch): Promise<{ found: Neighbour[]; complete: boolean } | null> {
  const rings = parcel.outline;
  if (!rings?.length) return null;
  const geometry = JSON.stringify({ rings, spatialReference: { wkid: 4326 } });
  try {
    const county = COUNTY_SOURCES.find((s) => s.name === parcel.source);
    if (county) {
      const body = new URLSearchParams({ geometry, geometryType: "esriGeometryPolygon", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "true", geometryPrecision: "7", f: "json" });
      const r = await fetcher(`${county.layer}/query`, { method: "POST", body, signal: AbortSignal.timeout(8000) } as RequestInit);
      if (!r.ok) return null;
      const j = await r.json();
      if (!Array.isArray(j?.features)) return null;
      const rows = j.features.map((f: any) => {
        const a = f.attributes ?? {};
        const acres = county.acres ? num(a[county.acres]) : county.areaSqft && num(a[county.areaSqft]) ? num(a[county.areaSqft])! / 43560 : null;
        return { propId: clean(a[county.id]), owner: clean(a[county.owner]), mailing: county.mailing.map((k) => clean(a[k])).filter(Boolean).join(", ") || null, situs: clean(a[county.situs]), acres: acres != null ? Math.round(acres * 100) / 100 : null, outline: f.geometry?.rings ?? null };
      });
      return { found: group(rows), complete: !j.exceededTransferLimit };
    }
    if (!parcel.source?.startsWith("TxGIO")) return null;
    const [w, s, e, n] = bbox(rings), pad = 0.002;
    const url = new URL(`${TEXAS_PARCEL_LAYER}/identify`);
    url.search = new URLSearchParams({ geometry, geometryType: "esriGeometryPolygon", sr: "4326", layers: "all:0", tolerance: "2",
      mapExtent: [w - pad, s - pad, e + pad, n + pad].join(","), imageDisplay: "800,800,96", returnGeometry: "true", f: "json" }).toString();
    const r = await fetcher(url, { signal: AbortSignal.timeout(8000) } as RequestInit);
    if (!r.ok) return null;
    const results = (await r.json())?.results;
    if (!Array.isArray(results)) return null;
    const lat = (s + n) / 2;
    const rows = results.map((x: any) => {
      const a = x.attributes ?? {};
      const merc = num(a["st_area(shape)"]);
      const acres = num(a.LEGAL_AREA) ?? (merc ? (merc * Math.cos((lat * Math.PI) / 180) ** 2) / SQM_PER_ACRE : null);
      return { propId: clean(a.PROP_ID), owner: clean(a.OWNER_NAME), mailing: clean(a.MAIL_ADDR), situs: clean(a.SITUS_ADDR), acres: acres != null ? Math.round(acres * 100) / 100 : null, outline: x.geometry?.rings ?? null };
    });
    // identify returns at most 20; a multi-tenant parcel fills that with tenant accounts.
    return { found: group(rows), complete: results.length < RESULT_CAP };
  } catch {
    return null;
  }
}

/**
 * Holdings for every site whose parcel is under `underAcres` (a bigger parcel
 * needs neither check). Returns each holding and the outline of the whole
 * holding, for measuring usable acres across it.
 */
export async function lookupHoldings(parcels: Array<Parcel | null>, underAcres = 3, limit = 8, budgetMs = 25000, fetcher: typeof fetch = fetch): Promise<Array<{ holding: Holding; outline: number[][][] | null } | null>> {
  const out: Array<{ holding: Holding; outline: number[][][] | null } | null> = new Array(parcels.length).fill(null);
  const todo = parcels.map((p, i) => (p && p.outline?.length && (p.acres == null || p.acres < underAcres) ? i : -1)).filter((i) => i >= 0);
  const deadline = Date.now() + budgetMs;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, async () => {
    while (next < todo.length) {
      const i = todo[next++], p = parcels[i]!;
      if (Date.now() >= deadline) continue;
      const hit = await lookupNeighbours(p, fetcher);
      if (!hit) continue;
      const holding = assessHolding(p, hit.found, hit.complete);
      const extra = hit.found.filter((n) => n.propId !== p.propId && holding.parcels.some((h) => h.propId === n.propId) && n.outline?.length);
      out[i] = { holding, outline: extra.length ? [...p.outline!, ...extra.flatMap((n) => n.outline!)] : p.outline ?? null };
    }
  }));
  return out;
}
