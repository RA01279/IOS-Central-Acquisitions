// lib/broker-contacts.ts
//
// Server side of lib/broker-match.ts: finds brokers in the contact book and
// saves the ones that aren't there yet, firm and all. Two calls:
//
//   proposeBrokers(text)   -> each person in the text with their exact match
//                             or "did you mean" candidates (for the picker)
//   ensureBrokers(entries) -> contact ids, creating whoever is new
//
// ensureBrokers never guesses: an entry with a contactId is that contact; a
// name links only on an exact match (same email, or same name at the same
// firm) and is otherwise created. The "did you mean" question is the
// picker's job, before anything gets here.

import { getServiceClient } from "./supabase";
import { fetchAll } from "./fetch-all";
import { tidyFirm } from "./firm-guess";
import { matchBroker, parseBrokers, type BrokerCandidate, type BrokerEntry, type BrokerInput, type BrokerMatch } from "./broker-match";

async function loadCandidates(): Promise<BrokerCandidate[]> {
  const db = getServiceClient();
  const rows = await fetchAll((f, t) =>
    db.from("contacts").select("id, name, email, phone, company_id, companies(name)").order("id").range(f, t)
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    company_id: r.company_id ?? null,
    company_name: r.companies?.name ?? null,
  }));
}

/** Who these are: free text ("Jane Smith, CBRE") or people an import already split out. */
export async function proposeBrokers(source: string | BrokerInput[]): Promise<BrokerMatch[]> {
  const people = typeof source === "string" ? parseBrokers(source) : source;
  if (!people.length) return [];
  const candidates = await loadCandidates();
  return people.map((p) => matchBroker(p, candidates));
}

/** The broker company with this name, created as a broker firm if it's new. */
async function firmId(name: string, cache: Map<string, string>): Promise<string> {
  const firm = tidyFirm(name).slice(0, 200);
  const key = firm.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const db = getServiceClient();
  // Compared tidied, so "Colliers (Houston)" or "CBRE, Inc." is the same firm as "Colliers" / "CBRE".
  const { data: all, error } = await db.from("companies").select("id, name").order("created_at");
  if (error) throw error;
  let id = (all ?? []).find((c: any) => tidyFirm(c.name).toLowerCase() === key)?.id as string | undefined;
  if (!id) {
    const { data: made, error: insertError } = await db.from("companies").insert({ name: firm, company_type: "broker" }).select("id").single();
    if (insertError) throw insertError;
    id = made.id as string;
  }
  cache.set(key, id);
  return id;
}

/**
 * Contact ids for these brokers, in order, without duplicates. New people are
 * created as brokers at their firm; a matched contact missing an email,
 * phone, firm or type gets them filled in (never overwritten).
 */
export async function ensureBrokers(entries: BrokerEntry[]): Promise<string[]> {
  const ids: string[] = [];
  const named = entries.filter((e): e is Exclude<BrokerEntry, { contactId: string }> => !("contactId" in e) && !!e.name?.trim());
  const candidates = named.length ? await loadCandidates() : [];
  const firms = new Map<string, string>();
  const db = getServiceClient();

  for (const e of entries) {
    if ("contactId" in e) {
      if (typeof e.contactId === "string" && /^[0-9a-f-]{36}$/i.test(e.contactId)) ids.push(e.contactId);
      continue;
    }
    const name = e.name?.trim().slice(0, 200);
    if (!name) continue;
    const input = { name, firm: e.firm?.trim() || null, email: e.email?.trim().toLowerCase() || null, phone: e.phone?.trim() || null };
    const { exact } = matchBroker(input, candidates);
    if (exact) {
      const patch: Record<string, unknown> = {};
      if (!exact.email && input.email) patch.email = input.email;
      if (!exact.phone && input.phone) patch.phone = input.phone;
      if (!exact.company_id && input.firm && input.firm.toLowerCase() !== name.toLowerCase()) patch.company_id = await firmId(input.firm, firms);
      if (Object.keys(patch).length) {
        const { error } = await db.from("contacts").update(patch).eq("id", exact.id);
        if (error) throw error;
      }
      await db.from("contacts").update({ contact_type: "broker" }).eq("id", exact.id).is("contact_type", null);
      ids.push(exact.id);
      continue;
    }
    const companyId = input.firm ? await firmId(input.firm, firms) : null;
    const { data: made, error } = await db
      .from("contacts")
      .insert({ name, email: input.email, phone: input.phone, company_id: companyId, contact_type: "broker" })
      .select("id")
      .single();
    if (error) throw error;
    ids.push(made.id);
    // Later entries in this same call (a portfolio's thirty sites) find them.
    candidates.push({ id: made.id, name, email: input.email, phone: input.phone, company_id: companyId, company_name: input.firm });
  }
  return [...new Set(ids)];
}

/** Request-body people (from an import) -> clean BrokerInputs. */
export function brokerInputs(list: unknown): BrokerInput[] {
  if (!Array.isArray(list)) return [];
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return list.slice(0, 20).flatMap((x: any) => {
    const name = s(x?.name, 200);
    return name ? [{ name, firm: s(x.firm, 200), email: s(x.email, 200)?.toLowerCase() ?? null, phone: s(x.phone, 40) }] : [];
  });
}

/** Request-body brokers -> entries: an array from the picker, or the old free-text field. */
export function brokerEntries(list: unknown, text: unknown): BrokerEntry[] {
  if (Array.isArray(list)) {
    return list.slice(0, 20).flatMap((x: any): BrokerEntry[] => {
      if (x && typeof x.contactId === "string") return [{ contactId: x.contactId }];
      if (x && typeof x.name === "string" && x.name.trim()) {
        const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
        return [{ name: x.name.trim().slice(0, 200), firm: s(x.firm, 200), email: s(x.email, 200), phone: s(x.phone, 40) }];
      }
      return [];
    });
  }
  return typeof text === "string" ? parseBrokers(text) : [];
}

/**
 * Brokers named on an outgoing LOI ("Jane Smith, CBRE" in Attn, plus the SLB
 * form's separate firm field), saved to Contacts and linked to each deal as
 * seller broker unless they already are. Returns how many links were added.
 */
export async function linkLoiBrokers(dealIds: string[], attn: unknown, firm: unknown): Promise<number> {
  const name = typeof attn === "string" ? attn.trim() : "";
  if (!name || !dealIds.length) return 0;
  const f = typeof firm === "string" ? firm.trim() : "";
  const text = f && !name.toLowerCase().includes(f.toLowerCase()) ? `${name}, ${f}` : name;
  const ids = await ensureBrokers(parseBrokers(text.slice(0, 400)));
  if (!ids.length) return 0;
  const db = getServiceClient();
  const { data: existing, error } = await db
    .from("deal_contacts").select("deal_id, contact_id").in("deal_id", dealIds).eq("role", "seller_broker").in("contact_id", ids);
  if (error) throw error;
  const have = new Set((existing ?? []).map((l: any) => `${l.deal_id}:${l.contact_id}`));
  const rows = dealIds.flatMap((deal_id) => ids.filter((c) => !have.has(`${deal_id}:${c}`)).map((contact_id) => ({ deal_id, contact_id, role: "seller_broker" })));
  if (!rows.length) return 0;
  const { error: insertError } = await db.from("deal_contacts").insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}
