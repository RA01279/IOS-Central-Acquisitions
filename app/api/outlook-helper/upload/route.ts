// app/api/outlook-helper/upload/route.ts
// The helper (bearer token) asks for a one-time storage slot for a PDF
// attachment it pulled from Outlook during a fetch_om job. The file goes
// straight to storage under the job owner's imports/ folder; the browser
// reads it from there to extract the OM text.
import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { helperJson, helperTokenHash, importOwnerDir } from "@/lib/outlook-helper";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return helperJson({ error: "Pairing expired or revoked." }, 401);
    const db = getServiceClient();
    const { data: helper } = await db.from("outlook_helpers").select("id,owner_email").eq("token_hash", helperTokenHash(token))
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!helper) return helperJson({ error: "Pairing expired or revoked." }, 401);
    const body = await req.json().catch(() => null);
    if (typeof body?.jobId !== "string") return helperJson({ error: "Invalid job" }, 400);
    const { data: job } = await db.from("outlook_helper_jobs").select("id").eq("id", body.jobId).eq("helper_id", helper.id)
      .eq("owner_email", helper.owner_email).eq("kind", "fetch_om").eq("status", "processing").maybeSingle();
    if (!job) return helperJson({ error: "Job is no longer active" }, 409);
    const path = `${importOwnerDir(helper.owner_email)}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.pdf`;
    const { data, error } = await db.storage.from("documents").createSignedUploadUrl(path);
    if (error || !data) throw error;
    return helperJson({ path: data.path, signedUrl: data.signedUrl });
  } catch {
    return helperJson({ error: "Could not prepare the upload." }, 500);
  }
}
