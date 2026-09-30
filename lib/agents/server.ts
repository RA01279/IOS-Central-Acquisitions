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
export async function reap(db: ReturnType<typeof getServiceClient>, email: string) {
  const { error } = await db.from("agent_runs").update({ status: "failed", error: "Run expired or the helper was interrupted. Start a new run.", finished_at: new Date().toISOString() })
    .eq("owner_email", email).in("status", ["queued", "processing"]).lt("created_at", new Date(Date.now() - 20 * 60000).toISOString());
  if (error) throw error;
}
