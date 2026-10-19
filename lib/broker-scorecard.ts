// lib/broker-scorecard.ts
//
// How each broker (person and firm) has done for us: deals they brought or
// represented, how far those got (offered, LOI, PSA, closed), comps their firm
// supplied, and when we last spoke. Built from deal_contacts (seller / buyer
// broker links), deals.source_broker_id (the firm credited at intake), comps'
// source notes (which name the firm that sent the workbook or email) and
// activities.
//
// scoreBrokers() is pure, so the test can feed it rows directly.

const OFFERED_OR_LATER = new Set(["offered", "moving_to_psa", "due_diligence", "closed"]);
const PSA_OR_LATER = new Set(["moving_to_psa", "due_diligence", "closed"]);
const BROKER_ROLES = ["seller_broker", "buyer_broker"];

export type ScoreDeal = {
  id: string;
  stage: string;
  death_stage: string | null;
  created_at: string;
  offers?: { offered_at: string | null; source?: string | null }[] | null;
  documents?: { doc_type: string }[] | null;
  deal_events?: { created_at: string }[] | null;
};

export type BrokerRow = {
  key: string; // contact id or company id
  kind: "person" | "firm";
  name: string;
  firm: string | null;
  firmId: string | null;
  deals: number;
  active: number;
  offered: number;
  lois: number;
  psa: number;
  closed: number;
  comps: number;
  lastTouch: string | null;
  dealIds: string[];
};

/** The furthest stage a deal reached: its own, or where it died. */
function reached(d: ScoreDeal): string {
  return d.stage === "archived" ? d.death_stage ?? "prospect" : d.stage;
}

function latest(...dates: (string | null | undefined)[]): string | null {
  return dates.filter(Boolean).sort().pop() ?? null;
}

function blank(key: string, kind: BrokerRow["kind"], name: string, firm: string | null, firmId: string | null): BrokerRow {
  return { key, kind, name, firm, firmId, deals: 0, active: 0, offered: 0, lois: 0, psa: 0, closed: 0, comps: 0, lastTouch: null, dealIds: [] };
}

function addDeal(row: BrokerRow, d: ScoreDeal) {
  if (row.dealIds.includes(d.id)) return;
  row.dealIds.push(d.id);
  row.deals++;
  const r = reached(d);
  if (d.stage !== "archived" && d.stage !== "closed") row.active++;
  if (OFFERED_OR_LATER.has(r) || (d.offers?.length ?? 0) > 0) row.offered++;
  if ((d.documents ?? []).some((x) => x.doc_type === "loi") || (d.offers ?? []).some((o) => o.source === "loi")) row.lois++;
  if (PSA_OR_LATER.has(r)) row.psa++;
  if (r === "closed") row.closed++;
  row.lastTouch = latest(row.lastTouch, d.created_at, ...(d.deal_events ?? []).map((e) => e.created_at));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Firm name inside a comp's source note, on word boundaries ("Rich Young Co." in "User-provided (Rich Young Co. - ...)"). */
export function mentionsFirm(note: string | null | undefined, firm: string): boolean {
  if (!note || !firm) return false;
  const f = norm(firm.replace(/\([^)]*\)/g, ""));
  if (f.length < 3) return false;
  return ` ${norm(note)} `.includes(` ${f} `);
}

export function scoreBrokers(input: {
  links: { role: string; contact: { id: string; name: string; company_id: string | null; company_name: string | null } | null; deal: ScoreDeal | null }[];
  sourced: { company_id: string; company_name: string; deal: ScoreDeal }[];
  companies: { id: string; name: string }[];
  compNotes: (string | null)[];
  activities: { contact_id: string | null; company_id: string | null; occurred_at: string }[];
}): { people: BrokerRow[]; firms: BrokerRow[] } {
  const people = new Map<string, BrokerRow>();
  const firms = new Map<string, BrokerRow>();
  const firm = (id: string, name: string) => {
    if (!firms.has(id)) firms.set(id, blank(id, "firm", name, name, id));
    return firms.get(id)!;
  };

  for (const l of input.links) {
    if (!l.contact || !l.deal || !BROKER_ROLES.includes(l.role)) continue;
    const c = l.contact;
    if (!people.has(c.id)) people.set(c.id, blank(c.id, "person", c.name, c.company_name, c.company_id));
    addDeal(people.get(c.id)!, l.deal);
    if (c.company_id && c.company_name) addDeal(firm(c.company_id, c.company_name), l.deal);
  }
  for (const s of input.sourced) addDeal(firm(s.company_id, s.company_name), s.deal);

  for (const co of input.companies) {
    const n = input.compNotes.filter((note) => mentionsFirm(note, co.name)).length;
    if (n) firm(co.id, co.name).comps = n;
  }
  for (const p of people.values()) if (p.firmId) p.comps = firms.get(p.firmId)?.comps ?? 0;

  for (const a of input.activities) {
    const p = a.contact_id ? people.get(a.contact_id) : null;
    if (p) {
      p.lastTouch = latest(p.lastTouch, a.occurred_at);
      if (p.firmId && firms.has(p.firmId)) firms.get(p.firmId)!.lastTouch = latest(firms.get(p.firmId)!.lastTouch, a.occurred_at);
    }
    const f = a.company_id ? firms.get(a.company_id) : null;
    if (f) f.lastTouch = latest(f.lastTouch, a.occurred_at);
  }

  const rank = (a: BrokerRow, b: BrokerRow) => b.closed - a.closed || b.psa - a.psa || b.offered - a.offered || b.deals - a.deals || a.name.localeCompare(b.name);
  return { people: [...people.values()].sort(rank), firms: [...firms.values()].sort(rank) };
}
