// app/api/agents/tools/route.ts
//
// Hopper's read-only tools for the agents (lib/agents/tools.ts), called by the
// helper's MCP bridge while Codex works a job.
//   GET                                    -> { tools: [{ name, description, inputSchema }] }
//   POST { jobId, tool, args }             -> { ok, text }
// Bearer: the helper's pairing token. A call is only served for a job that
// this helper is working right now (status processing) and whose agent may
// use tools (TOOL_AGENTS). Nothing here writes.

import { NextRequest } from "next/server";
import { workerContext, json } from "@/lib/agents/server";
import { UUID, TOOL_AGENTS } from "@/lib/agents/catalog";
import { runTool, toolDefinitions } from "@/lib/agents/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ctx = await workerContext(req);
  if (!ctx) return json({ error: "Pairing expired." }, 401);
  return json({ tools: toolDefinitions() });
}

export async function POST(req: NextRequest) {
  const ctx = await workerContext(req);
  if (!ctx) return json({ error: "Pairing expired." }, 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body.jobId !== "string" || !UUID.test(body.jobId) || typeof body.tool !== "string") return json({ error: "Invalid tool call." }, 400);
  const { db, helper } = ctx;
  const { data: job, error } = await db.from("agent_runs").select("agent").eq("id", body.jobId).eq("helper_id", helper.id).eq("owner_email", helper.owner_email).eq("status", "processing").maybeSingle();
  if (error) return json({ error: "Tools unavailable." }, 503);
  if (!job) return json({ error: "That job isn't running on this helper." }, 403);
  if (!(TOOL_AGENTS as readonly string[]).includes(job.agent)) return json({ error: "This agent works from its documents only." }, 403);
  return json(await runTool(body.tool, body.args));
}
