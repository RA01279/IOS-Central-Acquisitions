// lib/sync-export.ts -- the row shapes GET /api/export/sync hands to Prospector.
//
// Pure: takes the raw Supabase rows and returns plain JSON. Kept out of the
// route so scripts/test-sync-export.mjs can pin the shape without a database.
//
// Everything here is a *mirror* payload, not a roll-up: every acquisition deal
// in every stage (archived and closed included, that is where targets live),
// every offer, every task open or done, and the contact book -- companies,
// people, who is on which deal, and the activity log. Prospector keys its
// copies on `id`, so ids must be stable -- they are the Supabase uuids.
//
// Money and sizes come through as numbers or null, dates as ISO strings or
// null. Nothing is aggregated and nothing is inferred; Prospector does its
// own arithmetic against these rows.

const APP_URL = "https://ios-central-acquisitions.vercel.app";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === "" ? null : s;
}

export interface SyncDeal {
  id: string;
  url: string;
  stage: string;
  assetClass: "ios" | "industrial";
  address: string | null;
  city: string | null;
  market: string | null;
  submarket: string | null;
  lotSf: number | null;
  buildingSf: number | null;
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: string | null;
  occupancy: string | null;
  waltYears: number | null;
  tenancy: string | null;
  marketingStatus: string | null;
  acquisitionType: string | null;
  mlaStatus: string | null;
  ddEndOn: string | null;
  closingOn: string | null;
  closedOn: string | null;
  contractPrice: number | null;
  closedPrice: number | null;
  deathStage: string | null;
  deathReason: string | null;
  disposition: string | null;
  pursuitScore: number | null;
  followUpOn: string | null;
  assignedAnalyst: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SyncOffer {
  id: string;
  dealId: string;
  offeredAt: string | null;
  price: number | null;
  notes: string | null;
  source: string;
  createdBy: string | null;
  createdAt: string | null;
}

export interface SyncTask {
  id: string;
  dealId: string | null;
  title: string;
  notes: string | null;
  dueDate: string | null;
  status: "open" | "done";
  assignedTo: string | null;
  createdBy: string | null;
  completedAt: string | null;
  createdAt: string | null;
  contactId: string | null;
  companyId: string | null;
}

export interface SyncCompany {
  id: string;
  name: string;
  type: string | null;
  createdAt: string | null;
}

export interface SyncContact {
  id: string;
  companyId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  address: string | null;
  contactType: string | null;
  createdAt: string | null;
}

export interface SyncDealContact {
  id: string;
  dealId: string;
  contactId: string;
  role: string;
}

export interface SyncActivity {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  occurredAt: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  createdBy: string | null;
}

export function shapeDeal(d: any): SyncDeal {
  const p = d.properties ?? {};
  // Coordinates travel only when the deal is placed. A row that geocoded to
  // 'approximate' (city centroid) would pin a deal on the wrong block and
  // look authoritative once it is on Prospector's map.
  const placed =
    num(p.latitude) !== null &&
    num(p.longitude) !== null &&
    !(num(p.latitude) === 0 && num(p.longitude) === 0) &&
    ["rooftop", "range_interpolated", "geometric_center", "manual", "supplied"].includes(
      p.geocode_precision ?? ""
    );
  return {
    id: d.id,
    url: `${APP_URL}/deals/${d.id}`,
    stage: d.stage === "uw_v1" ? "uw" : d.stage,
    assetClass: d.asset_class === "industrial" ? "industrial" : "ios",
    address: str(p.address),
    city: str(p.city),
    market: str(p.market),
    submarket: str(p.submarket),
    lotSf: num(p.lot_sf),
    buildingSf: num(p.building_sf),
    latitude: placed ? num(p.latitude) : null,
    longitude: placed ? num(p.longitude) : null,
    geocodePrecision: placed ? str(p.geocode_precision) : null,
    occupancy: str(p.occupancy_status),
    waltYears: num(p.walt_years),
    tenancy: str(p.tenancy),
    marketingStatus: str(d.marketing_status),
    acquisitionType: str(d.acquisition_type),
    mlaStatus: str(d.mla_status),
    ddEndOn: str(d.dd_end_on),
    closingOn: str(d.closing_on),
    closedOn: str(d.closed_on),
    contractPrice: num(d.contract_price),
    closedPrice: num(d.closed_price),
    deathStage: str(d.death_stage),
    deathReason: str(d.death_reason),
    disposition: str(d.disposition),
    pursuitScore: num(d.pursuit_score),
    followUpOn: str(d.follow_up_on),
    assignedAnalyst: str(d.assigned_analyst),
    createdBy: str(d.created_by),
    createdAt: str(d.created_at),
    updatedAt: str(d.updated_at),
  };
}

export function shapeOffer(o: any): SyncOffer {
  return {
    id: o.id,
    dealId: o.deal_id,
    offeredAt: str(o.offered_at),
    price: num(o.price),
    notes: str(o.notes),
    source: o.source === "loi" ? "loi" : "manual",
    createdBy: str(o.created_by),
    createdAt: str(o.created_at),
  };
}

export function shapeTask(t: any): SyncTask {
  return {
    id: t.id,
    dealId: str(t.deal_id),
    title: String(t.title ?? ""),
    notes: str(t.notes),
    dueDate: str(t.due_date),
    status: t.status === "done" ? "done" : "open",
    assignedTo: str(t.assigned_to),
    createdBy: str(t.created_by),
    completedAt: str(t.completed_at),
    createdAt: str(t.created_at),
    contactId: str(t.contact_id),
    companyId: str(t.company_id),
  };
}

export function shapeCompany(c: any): SyncCompany {
  return {
    id: c.id,
    name: String(c.name ?? ""),
    type: str(c.company_type),
    createdAt: str(c.created_at),
  };
}

export function shapeContact(c: any): SyncContact {
  return {
    id: c.id,
    companyId: str(c.company_id),
    name: String(c.name ?? ""),
    email: str(c.email),
    phone: str(c.phone),
    title: str(c.title),
    address: str(c.address),
    contactType: str(c.contact_type),
    createdAt: str(c.created_at),
  };
}

export function shapeDealContact(l: any): SyncDealContact {
  return { id: l.id, dealId: l.deal_id, contactId: l.contact_id, role: String(l.role ?? "other") };
}

export function shapeActivity(a: any): SyncActivity {
  return {
    id: a.id,
    type: String(a.activity_type ?? "other"),
    subject: str(a.subject),
    body: str(a.body),
    occurredAt: str(a.occurred_at),
    contactId: str(a.contact_id),
    companyId: str(a.company_id),
    dealId: str(a.deal_id),
    createdBy: str(a.created_by),
  };
}

// Sale and lease comps, the whole repository. Prospector copies them into its
// own comps table keyed on `id` (added Oct 2026, additive: a consumer that
// ignores the key is unaffected, so no schemaVersion bump).
export interface SyncComp {
  id: string;
  compType: string;
  address: string | null;
  projectName: string | null;
  suite: string | null;
  city: string | null;
  state: string | null;
  market: string | null;
  submarket: string | null;
  assetClass: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: string | null;
  buildingSf: number | null;
  lotSf: number | null;
  yardAcres: number | null;
  coveragePct: number | null;
  yearBuilt: number | null;
  clearHeightFt: number | null;
  rent: number | null;
  rentBasis: string | null;
  leaseType: string | null;
  camPsfAnnual: number | null;
  dateCommenced: string | null;
  dateEstimated: boolean;
  tenantName: string | null;
  salePrice: number | null;
  closedOn: string | null;
  capRate: number | null;
  buyer: string | null;
  status: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function shapeComp(c: any): SyncComp {
  return {
    id: c.id,
    compType: String(c.comp_type ?? "lease"),
    address: str(c.address),
    projectName: str(c.project_name),
    suite: str(c.suite),
    city: str(c.city),
    state: str(c.state),
    market: str(c.market),
    submarket: str(c.submarket),
    assetClass: str(c.asset_class),
    latitude: num(c.latitude),
    longitude: num(c.longitude),
    geocodePrecision: str(c.geocode_precision),
    buildingSf: num(c.building_sf),
    lotSf: num(c.lot_sf),
    yardAcres: num(c.yard_acres),
    coveragePct: num(c.coverage_pct),
    yearBuilt: num(c.year_built),
    clearHeightFt: num(c.clear_height_ft),
    rent: num(c.rent),
    rentBasis: str(c.rent_basis),
    leaseType: str(c.lease_type),
    camPsfAnnual: num(c.cam_psf_annual),
    dateCommenced: str(c.date_commenced),
    dateEstimated: c.date_estimated === true,
    tenantName: str(c.tenant_name),
    salePrice: num(c.sale_price),
    closedOn: str(c.closed_on),
    capRate: num(c.cap_rate),
    buyer: str(c.buyer),
    status: str(c.status),
    createdBy: str(c.created_by),
    createdAt: str(c.created_at),
    updatedAt: str(c.updated_at),
  };
}

export interface SyncPayload {
  source: "hopper";
  schemaVersion: 2;
  generatedAt: string;
  asOfDate: string;
  deals: SyncDeal[];
  offers: SyncOffer[];
  tasks: SyncTask[];
  companies: SyncCompany[];
  contacts: SyncContact[];
  dealContacts: SyncDealContact[];
  activities: SyncActivity[];
  comps: SyncComp[];
}

// The feed's key travels as "Authorization: Bearer <key>". Compared without
// an early exit so a wrong guess learns nothing from the timing, and an unset
// secret matches nothing -- a route that forgot its env var must stay shut.
// Written by hand: this file has no imports, so the test can load it bare.
export function bearerMatches(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const expected = `Bearer ${secret}`;
  let diff = header.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= (header.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// Offers that hang off a lease deal (or an orphaned deal id) are dropped:
// Prospector only mirrors acquisitions, and a child without its parent would
// be an error on the other side rather than a row. Links follow the same rule
// and also need their person in the payload.
export function buildSyncPayload(
  raw: {
    deals: any[];
    offers: any[];
    tasks: any[];
    companies: any[];
    contacts: any[];
    dealContacts: any[];
    activities: any[];
    comps?: any[];
  },
  opts: { now: Date; asOfDate: string }
): SyncPayload {
  const deals = raw.deals.filter((d) => d.deal_type === "acquisition").map(shapeDeal);
  const known = new Set(deals.map((d) => d.id));
  const offers = raw.offers.filter((o) => known.has(o.deal_id)).map(shapeOffer);
  const companies = raw.companies.map(shapeCompany);
  const contacts = raw.contacts.map(shapeContact);
  const people = new Set(contacts.map((c) => c.id));
  const dealContacts = raw.dealContacts
    .filter((l) => known.has(l.deal_id) && people.has(l.contact_id))
    .map(shapeDealContact);
  // A task or a logged call with no deal is still a row -- Prospector decides
  // what to do with it. One on a lease deal is not ours to mirror, unless it
  // is about a person or a company: then it belongs to their history and
  // travels without the deal.
  const forMirror = <T extends { dealId: string | null; contactId: string | null; companyId: string | null }>(
    rows: T[]
  ): T[] =>
    rows
      .filter((r) => !r.dealId || known.has(r.dealId) || r.contactId || r.companyId)
      .map((r) => (r.dealId && !known.has(r.dealId) ? { ...r, dealId: null } : r));
  const tasks = forMirror(raw.tasks.map(shapeTask));
  const activities = forMirror(raw.activities.map(shapeActivity));
  return {
    source: "hopper",
    schemaVersion: 2,
    generatedAt: opts.now.toISOString(),
    asOfDate: opts.asOfDate,
    deals,
    offers,
    tasks,
    companies,
    contacts,
    dealContacts,
    activities,
    comps: (raw.comps ?? []).map(shapeComp),
  };
}
