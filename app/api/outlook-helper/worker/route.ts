import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { cleanupHelperJobs, helperJson, helperTokenHash, importOwnerDir, safeResult } from "@/lib/outlook-helper";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authenticate(req: NextRequest) {
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return null;
  const db = getServiceClient();
  const { data, error } = await db.from("outlook_helpers").select("id,owner_email,token_hash").eq("token_hash", helperTokenHash(token))
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !data) return null;
  return { db, helper: data };
}
export async function GET(req: NextRequest) {
 try {
  const ctx = await authenticate(req);
  if (!ctx) return helperJson({ error: "Pairing expired or revoked. Pair again in Hopper." }, 401);
  const { db, helper } = ctx;
  await cleanupHelperJobs(db);
  // Recover interrupted helpers; do not retry a mailbox read silently.
  await db.from("outlook_helper_jobs").update({ status: "failed", error: "The email request timed out. Please try again." })
    .eq("helper_id", helper.id).in("status", ["queued", "processing"]).lt("created_at", new Date(Date.now() - 180000).toISOString());
  const { error: heartbeatError } = await db.from("outlook_helpers").update({ last_seen_at: new Date().toISOString(),
    mailbox_email: helper.owner_email }).eq("id", helper.id).eq("token_hash", helper.token_hash);
  if (heartbeatError) throw heartbeatError;
  const { data: candidate, error } = await db.from("outlook_helper_jobs").select("id").eq("helper_id", helper.id)
    .eq("owner_email", helper.owner_email).eq("status", "queued").order("created_at").limit(1).maybeSingle();
  if (error) throw error;
  if (!candidate) return helperJson({ ownerEmail: helper.owner_email, job: null });
  const claimed = await db.from("outlook_helper_jobs").update({ status: "processing" })
    .eq("id", candidate.id).eq("helper_id", helper.id).eq("status", "queued").select("id,kind,input").maybeSingle();
  if (claimed.error) throw claimed.error;
  return helperJson({ ownerEmail: helper.owner_email, job: claimed.data });
 } catch { return helperJson({ error: "Helper temporarily unavailable." }, 503); }
}
export async function POST(req: NextRequest) {
 try {
  const ctx = await authenticate(req);
  if (!ctx) return helperJson({ error: "Pairing expired or revoked." }, 401);
  const { db, helper } = ctx;
  const raw = await req.text();
  if (raw.length > 2_100_000) return helperJson({ error: "Email is too large." }, 413);
  const body = JSON.parse(raw);
  if (typeof body?.id !== "string") return helperJson({ error: "Invalid job" }, 400);
  const { data: job, error } = await db.from("outlook_helper_jobs").select("id,kind,status").eq("id", body.id)
    .eq("helper_id", helper.id).eq("owner_email", helper.owner_email).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !job) return helperJson({ error: "Job expired or unavailable" }, 404);
  if (job.status !== "processing") return helperJson({ error: "Job is no longer active" }, 409);
  let result = null; let failure: string | null = null;
  try {
    if (body.error) failure = String(body.error).slice(0, 500);
    else {
      result = safeResult(job.kind, body.result);
      // Only files in this owner's own import folder may be referenced.
      if (result && "attachments" in result) {
        const dir = importOwnerDir(helper.owner_email) + "/";
        result.attachments = (result.attachments as any[]).filter((a) => a.path.startsWith(dir));
      }
    }
  }
  catch (e) { failure = e instanceof Error ? e.message : "Invalid result"; }
  const updated = await db.from("outlook_helper_jobs").update({ status: failure ? "failed" : "completed", result, error: failure })
    .eq("id", job.id).eq("helper_id", helper.id).eq("status", "processing");
  if (updated.error) throw updated.error;
  return helperJson({ ok: true });
 } catch { return helperJson({ error: "Could not receive email result." }, 500); }
}
