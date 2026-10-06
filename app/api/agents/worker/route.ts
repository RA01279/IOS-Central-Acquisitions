import { parseMemo, MEMO_VERSION } from "@/lib/agents/memo";
import { parseNarrative } from "@/lib/agents/ic-narrative";
import { parseSourcing } from "@/lib/agents/sourcing";
import { parseDealImport } from "@/lib/agents/deal-import";
import { NextRequest } from "next/server";
import { workerContext, json, reap } from "@/lib/agents/server";
import { UUID } from "@/lib/agents/catalog";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
 try {
  const ctx = await workerContext(req); if (!ctx) return json({ error: "Pairing expired." }, 401);
  const { db, helper } = ctx;
  await reap(db, helper.owner_email);
  const heartbeat = await db.from("outlook_helpers").update({ agents_last_seen_at: new Date().toISOString() }).eq("id", helper.id).eq("token_hash", helper.token_hash);
  if (heartbeat.error) throw heartbeat.error;
  if (req.nextUrl.searchParams.has("heartbeat")) return json({ ok: true });
  const { data, error } = await db.from("agent_runs").select("id").eq("owner_email", helper.owner_email).eq("helper_id", helper.id).eq("status", "queued").order("created_at").limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return json({ job: null });
  const claimed = await db.from("agent_runs").update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", data.id).eq("helper_id", helper.id).eq("status", "queued").select("id,agent,prompt").maybeSingle();
  if (claimed.error) throw claimed.error;
  return json({ job: claimed.data });
 } catch { return json({ error: "Agent queue unavailable." }, 503); }
}
export async function POST(req: NextRequest) {
 try {
  const ctx = await workerContext(req); if (!ctx) return json({ error: "Pairing expired." }, 401);
  const raw = await req.text(); if (raw.length > 150000) return json({ error: "Report too large." }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: "Invalid result." }, 400); }
  if (!body || typeof body.id !== "string" || !UUID.test(body.id)) return json({ error: "Invalid run." }, 400);
  const r = body.result;
  if (!body.error && (!r || typeof r.report !== "string" || !r.report.trim() || r.report.length > 100000 ||
    typeof r.model !== "string" || r.model.length > 200 || !Array.isArray(r.limitations) || r.limitations.length > 30 || r.limitations.some((v: unknown) => typeof v !== "string" || v.length > 1000))) return json({ error: "Malformed report." }, 400);
  const { db, helper } = ctx;
  const job = await db.from("agent_runs").select("agent,prompt").eq("id", body.id).eq("helper_id", helper.id).eq("owner_email", helper.owner_email).eq("status", "processing").maybeSingle();
  if (job.error) throw job.error;
  if (!job.data) return json({ error: "Run no longer active." }, 409);
  if (!body.error && job.data.agent === "investment-memo" && job.data.prompt?.includes(MEMO_VERSION) && !parseMemo(r.report)) {
    body.error = "The memo did not match the 25-slide template. Please generate it again with shorter source text.";
  }
  if (!body.error && job.data.agent === "ic-narrative" && !parseNarrative(r.report)) {
    body.error = "The narrative did not match the IC deck format (every bullet needs a source). Please run it again.";
  }
  if (!body.error && job.data.agent === "off-market-sourcing" && !parseSourcing(r.report)) {
    body.error = "The sourcing report did not match the expected format (owner and parcel facts need sources). Please run it again.";
  }
  if (!body.error && job.data.agent === "deal-import" && !parseDealImport(r.report)) {
    body.error = "Could not read a property address from that document. Check it is an OM or broker email, then try again.";
  }
  const update = await db.from("agent_runs").update({ status: body.error ? "failed" : "completed",
    result: body.error ? null : { report: r.report, limitations: r.limitations }, model: body.error ? null : r.model,
    error: body.error ? String(body.error).slice(0, 500) : null, usage: body.usage && typeof body.usage === "object" ? body.usage : null,
    finished_at: new Date().toISOString() }).eq("id", body.id).eq("helper_id", helper.id).eq("owner_email", helper.owner_email)
    .eq("status", "processing").select("id").maybeSingle();
  if (update.error) throw update.error;
  return update.data ? json({ ok: true }) : json({ error: "Run no longer active." }, 409);
 } catch { return json({ error: "Could not save report." }, 500); }
}
