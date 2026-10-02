import { NextRequest } from "next/server";
import { userContext, json, reap } from "@/lib/agents/server";
import { AGENTS, UUID, isAgentId, buildPrompt } from "@/lib/agents/catalog";
import { loadEvidence } from "@/lib/agents/context";
import { MAX_SOURCING_SITES } from "@/lib/agents/sourcing";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
 try {
  const ctx = await userContext(req); if (ctx.response) return ctx.response;
  const { db, email } = ctx; await reap(db, email);
  const id = req.nextUrl.searchParams.get("id");
  // Latest run of one agent for one deal (the IC deck builder's narrative).
  const latest = req.nextUrl.searchParams.get("latest"), dealParam = req.nextUrl.searchParams.get("deal");
  if (latest) {
    if (!isAgentId(latest) || !dealParam || !UUID.test(dealParam)) return json({ error: "Invalid request." }, 400);
    const { data, error } = await db.from("agent_runs").select("id,status,error,created_at,finished_at")
      .eq("owner_email", email).eq("deal_id", dealParam).eq("agent", latest).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return json({ run: data ?? null });
  }
  if (id) {
    if (!UUID.test(id)) return json({ error: "Invalid report." }, 400);
    const { data, error } = await db.from("agent_runs").select("id,agent,deal_id,status,sources,result,error,created_at,reviewed_at,model,usage")
      .eq("id", id).eq("owner_email", email).maybeSingle();
    if (error || !data) return json({ error: "Report unavailable." }, 404);
    return json(data);
  }
  const [runs, helper, deals] = await Promise.all([
    db.from("agent_runs").select("id,agent,status,created_at,reviewed_at").eq("owner_email", email).order("created_at", { ascending: false }).limit(30),
    db.from("outlook_helpers").select("agents_last_seen_at,expires_at").eq("owner_email", email).maybeSingle(),
    db.from("deals").select("id,properties(address)").order("updated_at", { ascending: false }).limit(500),
  ]);
  if (runs.error || helper.error || deals.error) throw new Error();
  const online = !!helper.data?.agents_last_seen_at && Date.parse(helper.data.expires_at) > Date.now() && Date.now() - Date.parse(helper.data.agents_last_seen_at) < 45000;
  return json({ runs: runs.data, deals: deals.data, online });
 } catch { return json({ error: "Agent storage is unavailable. Apply the Hopper agents migration and restart the helper." }, 503); }
}
export async function POST(req: NextRequest) {
 try {
  const ctx = await userContext(req, true); if (ctx.response) return ctx.response;
  const { db, email } = ctx;
  const raw = await req.text(); if (raw.length > 120000) return json({ error: "Limit source text to 100,000 characters." }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: "Invalid request." }, 400); }
  if (!body || !isAgentId(body.agent) || typeof body.text !== "string" || body.text.length > 100000 ||
      (body.dealId && (typeof body.dealId !== "string" || !UUID.test(body.dealId)))) return json({ error: "Check the agent, deal and source text." }, 400);
  const agent = AGENTS.find(a => a.id === body.agent)!;
  if (agent.needsDeal && !body.dealId) return json({ error: "Select a deal first." }, 400);
  if (body.agent === "deal-intake" && !body.text.trim()) return json({ error: "Paste the broker email or offering text." }, 400);
  if (body.agent === "off-market-sourcing") {
    let sweep: any = null; try { sweep = JSON.parse(body.text); } catch {}
    if (!Array.isArray(sweep?.sites) || !sweep.sites.length || sweep.sites.length > MAX_SOURCING_SITES) return json({ error: `Select 1 to ${MAX_SOURCING_SITES} sites from a sweep.` }, 400);
  }
  const { data: helper, error: he } = await db.from("outlook_helpers").select("id,agents_last_seen_at").eq("owner_email", email).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (he) throw he;
  if (!helper?.agents_last_seen_at || Date.now() - Date.parse(helper.agents_last_seen_at) > 45000) return json({ error: "Start the updated Hopper helper on your computer." }, 409);
  await reap(db, email);
  const evidence = await loadEvidence(body.agent, body.dealId || undefined);
  const prompt = buildPrompt(body.agent, evidence, body.text, new Date().toISOString());
  if (prompt.length > 350000) return json({ error: "Evidence is too large. Narrow the selected deal or shorten the source text." }, 413);
  const { data, error } = await db.from("agent_runs").insert({ owner_email: email, helper_id: helper.id, agent: body.agent,
    deal_id: body.dealId || null, prompt, sources: evidence }).select("id").single();
  if (error?.code === "23505") return json({ error: "A report is already running. Wait for it to finish." }, 409);
  if (error) throw error;
  return json(data, 202);
 } catch { return json({ error: "Could not prepare the report. No deal records were changed." }, 500); }
}
