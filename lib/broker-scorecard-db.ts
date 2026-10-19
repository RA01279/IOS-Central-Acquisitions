// lib/broker-scorecard-db.ts
//
// Loads the rows lib/broker-scorecard.ts scores. Everything is paged
// (fetchAll) and any failed query throws -- a scorecard missing half its
// deals would rank brokers wrongly without saying so.

import { cache } from "react";
import { getServiceClient } from "./supabase";
import { fetchAll } from "./fetch-all";
import { scoreBrokers } from "./broker-scorecard";

const DEAL_FIELDS = "id, stage, death_stage, created_at, offers(offered_at, source), documents(doc_type), deal_events(created_at)";

export const loadBrokerScorecard = cache(async () => {
  const db = getServiceClient();
  const [links, sourced, companies, comps, activities] = await Promise.all([
    fetchAll((f, t) =>
      db.from("deal_contacts")
        .select(`id, role, contacts(id, name, company_id, companies(name)), deals!inner(${DEAL_FIELDS}, deal_type)`)
        .in("role", ["seller_broker", "buyer_broker"])
        .eq("deals.deal_type", "acquisition")
        .order("id").range(f, t)),
    fetchAll((f, t) =>
      db.from("deals").select(`${DEAL_FIELDS}, source_broker_id, companies:source_broker_id(id, name)`)
        .not("source_broker_id", "is", null).eq("deal_type", "acquisition").order("id").range(f, t)),
    fetchAll((f, t) => db.from("companies").select("id, name").eq("company_type", "broker").order("id").range(f, t)),
    fetchAll((f, t) => db.from("comps").select("id, source_ref").order("id").range(f, t)),
    fetchAll((f, t) =>
      db.from("activities").select("id, contact_id, company_id, occurred_at")
        .or("contact_id.not.is.null,company_id.not.is.null").order("id").range(f, t)),
  ]);

  return scoreBrokers({
    links: links.map((l: any) => ({
      role: l.role,
      contact: l.contacts ? { id: l.contacts.id, name: l.contacts.name, company_id: l.contacts.company_id ?? null, company_name: l.contacts.companies?.name ?? null } : null,
      deal: l.deals ?? null,
    })),
    sourced: sourced
      .filter((d: any) => d.companies)
      .map((d: any) => ({ company_id: d.companies.id, company_name: d.companies.name, deal: d })),
    companies,
    compNotes: comps.map((c: any) => c.source_ref ?? null),
    activities,
  });
});
