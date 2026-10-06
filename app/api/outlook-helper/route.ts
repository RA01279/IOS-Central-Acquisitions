import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { cleanupHelperJobs, helperJson, helperTokenHash, validInput } from "@/lib/outlook-helper";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function context(req: NextRequest, mutation = false) {
  const user = await getCurrentUser(req);
  if (!user) return { response: helperJson({ error: "Not authenticated" }, 401) };
  if (mutation && (!req.headers.get("origin") || new URL(req.headers.get("origin")!).host !== req.headers.get("host")))
    return { response: helperJson({ error: "Invalid request origin" }, 403) };
  const db = getServiceClient();
  await cleanupHelperJobs(db);
  return { db, email: user.email.toLowerCase() };
}
export async function GET(req: NextRequest) {
 try {
  const ctx = await context(req); if (ctx.response) return ctx.response;
  const { db, email } = ctx;
  const jobId = req.nextUrl.searchParams.get("job");
  if (jobId) {
    const { data, error } = await db.from("outlook_helper_jobs").select("id,status,result,error").eq("id", jobId).eq("owner_email", email).maybeSingle();
    if (error || !data) return helperJson({ error: "Import expired or unavailable. Search again." }, 404);
    return helperJson(data);
  }
  const { data, error } = await db.from("outlook_helpers").select("id,last_seen_at,mailbox_email,expires_at").eq("owner_email", email).maybeSingle();
  if (error) throw error;
  const paired = !!data && Date.parse(data.expires_at) > Date.now();
  return helperJson({ paired, online: paired && !!data?.last_seen_at && Date.now() - Date.parse(data.last_seen_at) < 30000,
    mailbox: paired ? data?.mailbox_email : null });
 } catch { return helperJson({ error: "Outlook helper is unavailable. Please try again." }, 503); }
}
export async function POST(req: NextRequest) {
 try {
  const ctx = await context(req, true); if (ctx.response) return ctx.response;
  const { db, email } = ctx;
  const body = await req.json();
  if (body?.action === "pair") {
    const token = randomBytes(32).toString("base64url");
    // Rotation revokes the previous helper before a new one can claim work.
    const { data, error } = await db.from("outlook_helpers").upsert({ owner_email: email,
      token_hash: helperTokenHash(token), last_seen_at: null, mailbox_email: null,
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString() }, { onConflict: "owner_email" }).select("id").single();
    if (error) throw error;
    const removed = await db.from("outlook_helper_jobs").delete().eq("helper_id", data.id);
    if (removed.error) throw removed.error;
    return helperJson({ token });
  }
  if (body?.action !== "enqueue" || !validInput(body.kind, body.input)) return helperJson({ error: "Invalid email request" }, 400);
  const { data: helper, error: helperError } = await db.from("outlook_helpers").select("*").eq("owner_email", email).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (helperError) throw helperError;
  if (!helper?.last_seen_at || Date.now() - Date.parse(helper.last_seen_at) > 30000)
    return helperJson({ error: "Your Outlook helper is offline. Start it on your computer and try again." }, 409);
  if (body.kind === "fetch" || body.kind === "fetch_om") {
    const { data: search } = await db.from("outlook_helper_jobs").select("result").eq("id", body.input.searchJobId)
      .eq("owner_email", email).eq("helper_id", helper.id).eq("kind", "search").eq("status", "completed").maybeSingle();
    if (!search?.result?.messages?.some((m: any) => m.id === body.input.messageId))
      return helperJson({ error: "Search again, then choose an email from the results." }, 400);
  }
  // A partial unique index prevents overlapping jobs for a single helper.
  const { data, error } = await db.from("outlook_helper_jobs").insert({
    helper_id: helper.id, owner_email: email, kind: body.kind, input: body.input,
  }).select("id").single();
  if (error?.code === "23505") return helperJson({ error: "An email request is still running. Please wait." }, 409);
  if (error) throw error;
  return helperJson(data, 202);
 } catch { return helperJson({ error: "Could not start the email request." }, 500); }
}
export async function DELETE(req: NextRequest) {
 try {
  const ctx = await context(req, true); if (ctx.response) return ctx.response;
  const { error } = await ctx.db.from("outlook_helpers").delete().eq("owner_email", ctx.email);
  if (error) throw error;
  return helperJson({ disconnected: true });
 } catch { return helperJson({ error: "Could not disconnect the helper." }, 500); }
}
