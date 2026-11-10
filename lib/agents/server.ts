import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { helperJson, helperTokenHash } from "@/lib/outlook-helper";
import type { NextRequest } from "next/server";
export { helperJson as json };
export async function userContext(req: NextRequest, mutation = false) {
  const user = await getCurrentUser(req);
  if (!user) return { response: helperJson({ error: "Sign in to Hopper." }, 401) };
  if (mutation) {
    let origin: URL;
    try { origin = new URL(req.headers.get("origin") || ""); } catch { return { response: helperJson({ error: "Invalid origin." }, 403) }; }
    if (origin.host !== req.headers.get("host")) return { response: helperJson({ error: "Invalid origin." }, 403) };
  }
  return { db: getServiceClient(), email: user.email.toLowerCase() };
}
export async function workerContext(req: NextRequest) {
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return null;
  const db = getServiceClient();
  const { data, error } = await db.from("outlook_helpers").select("id,owner_email,token_hash")
    .eq("token_hash", helperTokenHash(token)).gt("expires_at", new Date().toISOString()).maybeSingle();
  return error || !data ? null : { db, helper: data };
}
/** Most agent runs one person can have queued or running at once (the helper works several in parallel). */
export const MAX_ACTIVE_RUNS = 30;
/** A run being worked longer than this was interrupted (a draft pass + a fact-check pass take up to ~25 minutes). */
const PROCESSING_LIMIT_MIN = 40;
/** A run nobody picked up for this long is abandoned (the helper was off). */
const QUEUED_LIMIT_HOURS = 8;

/** Fails runs that were interrupted mid-way or never picked up. */
export async function reap(db: ReturnType<typeof getServiceClient>, email: string) {
  const now = Date.now(), finished_at = new Date(now).toISOString();
  const [stuck, abandoned] = await Promise.all([
    db.from("agent_runs").update({ status: "failed", error: "The helper was interrupted or the run took too long. Start a new run.", finished_at })
      .eq("owner_email", email).eq("status", "processing").lt("started_at", new Date(now - PROCESSING_LIMIT_MIN * 60000).toISOString()),
    db.from("agent_runs").update({ status: "failed", error: "No helper picked this run up. Start the Hopper helper and run it again.", finished_at })
      .eq("owner_email", email).eq("status", "queued").lt("created_at", new Date(now - QUEUED_LIMIT_HOURS * 3600000).toISOString()),
  ]);
  if (stuck.error) throw stuck.error;
  if (abandoned.error) throw abandoned.error;
}
