import { getServiceClient } from "@/lib/supabase";
import type { AgentId, Evidence } from "./catalog";
import { COMP_POLICY, haversineMiles, isUsableForDistance } from "@/lib/comps/match";
import { subjectOf } from "@/lib/comps/evidence";
import { readAllCompPages } from "@/lib/comps/mapData";

// Hopper is a shared acquisitions workspace; existing deal APIs use the same
// authenticated workspace access. Agent reports remain private to the requester.
export async function loadEvidence(agent: AgentId, dealId?: string): Promise<Evidence[]> {
  const db = getServiceClient();
  const sources: Evidence[] = [];
  let subject: any = null;
  if (dealId) {
    const { data, error } = await db.from("deals").select("*,properties(*)").eq("id", dealId).maybeSingle();
    if (error || !data) throw new Error("The selected deal could not be loaded.");
    subject = data;
    // Web-searching agents receive only public property location, never deal economics.
    sources.push({ label: "Subject deal", href: `/deals/${dealId}`, data: agent === "site-research" || agent === "ic-narrative"
      ? { address: data.properties?.address, market: data.properties?.market, latitude: data.properties?.latitude, longitude: data.properties?.longitude }
      : data });
  }
  if (agent === "pipeline-follow-up" || agent === "deal-intake") {
    const { data, error } = await db.from("deals").select("id,stage,created_at,updated_at,dd_end_on,closing_on,mla_status,properties(address,market)")
      .order("updated_at", { ascending: false }).limit(501);
    if (error) throw new Error("Could not load pipeline evidence.");
    sources.push({ label: "Pipeline snapshot", href: "/deals", data: { coverage: (data?.length || 0) > 500 ? "Most recently updated 500 deals; not exhaustive" : "Current deal snapshot", deals: data?.slice(0, 500).map(d => ({ ...d, href: `/deals/${d.id}` })) } });
  }
  if (agent === "comp-analyst" || agent === "investment-memo") {
    // Confirmed comps only, nearest first when the deal has a usable pin --
    // the evidence the Financials tab works from, not whatever was typed in
    // last under a market label that may be spelled differently.
    const s = subject ? subjectOf(subject) : null;
    const located = s?.lat != null && s?.lng != null && isUsableForDistance(subject.properties?.geocode_precision);
    let comps: any[];
    let coverage: string;
    if (located) {
      const rows = await readAllCompPages<any>((from, to) =>
        db.from("comps").select("*").eq("status", "confirmed").not("latitude", "is", null).order("id").range(from, to) as any);
      comps = rows
        .filter(c => isUsableForDistance(c.geocode_precision))
        .map(c => ({ ...c, distance_mi: Math.round(haversineMiles(s!.lat!, s!.lng!, Number(c.latitude), Number(c.longitude)) * 10) / 10 }))
        .sort((a, b) => a.distance_mi - b.distance_mi)
        .slice(0, 100);
      coverage = `Confirmed comps nearest the subject (Hopper's standard market window is ${COMP_POLICY.radiusMiles} mi / ${COMP_POLICY.maxAgeMonths} mo); 100 nearest, not exhaustive`;
    } else {
      let query = db.from("comps").select("*").eq("status", "confirmed").order("created_at", { ascending: false }).limit(100);
      const market = subject?.properties?.market;
      if (market) query = query.eq("market", market);
      const { data, error } = await query;
      if (error) throw new Error("Could not load comp evidence.");
      comps = data ?? [];
      coverage = `${market ? "Same market label" : "All markets"} (subject has no precise pin); latest 100 confirmed records, not exhaustive`;
    }
    sources.push({ label: "Comp records", href: "/comps", data: { coverage, comps: comps.map(c => ({ ...c, href: `/comps/${c.id}` })) } });
  }
  if (dealId && agent !== "site-research" && agent !== "ic-narrative") {
    const results = await Promise.all([
      db.from("deal_events").select("event_type,detail,created_at").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(50),
      db.from("uw_versions").select("version_number,returns_summary,created_at").eq("deal_id", dealId).order("version_number", { ascending: false }).limit(3),
    ]);
    if (results.some(r => r.error)) throw new Error("Could not load the deal history and underwriting summaries.");
    sources.push({ label: "Recorded deal history (latest 50 events)", data: results[0].data });
    sources.push({ label: "Recorded underwriting summaries (not workbook contents)", data: results[1].data });
  }
  return sources;
}
