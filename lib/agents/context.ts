import { getServiceClient } from "@/lib/supabase";
import type { AgentId, Evidence } from "./catalog";

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
    // Site research receives only public property location, not deal economics.
    sources.push({ label: "Subject deal", href: `/deals/${dealId}`, data: agent === "site-research"
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
    let query = db.from("comps").select("*").order("created_at", { ascending: false }).limit(101);
    const market = subject?.properties?.market;
    if (market) query = query.eq("market", market);
    const { data, error } = await query;
    if (error) throw new Error("Could not load comp evidence.");
    sources.push({ label: "Comp records", href: "/comps", data: { coverage: `${market ? "Same market" : "All markets"}; latest 100 entered records, not exhaustive`, comps: data?.slice(0, 100).map(c => ({ ...c, href: `/comps/${c.id}` })) } });
  }
  if (dealId && agent !== "site-research") {
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
