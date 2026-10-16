import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent } from "@/lib/deals";
import { fireStageChangeWebhook } from "@/lib/webhooks";
import { getCurrentUser } from "@/lib/auth";
import { parseReturnsSummary } from "@/lib/excel-parser";

// POST /api/deals/[id]/versions
// body: { storagePath, fileName } -- the browser has ALREADY uploaded the
// workbook straight to Supabase Storage via a signed URL (see ../upload-url;
// Vercel's ~4.5MB request cap made multipart uploads through this route 413
// on real underwriting models). This route downloads it from storage, reads
// the "Summary Table" tab, and appends a version row -- never overwrites a
// prior version.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.storagePath) {
    return NextResponse.json({ error: "Missing storagePath" }, { status: 400 });
  }
  // Only a workbook ../upload-url issued for THIS deal. Any other path would
  // let a version row point at (and hand out signed links to) any file in the
  // bucket, including other people's imports.
  const storagePath = String(body.storagePath);
  const prefix = `deals/${params.id}/uw-`;
  if (!storagePath.startsWith(prefix) || !/^[A-Za-z0-9._-]+$/.test(storagePath.slice(prefix.length)) || !/\.(xlsx|xlsm)$/i.test(storagePath)) {
    return NextResponse.json({ error: "That upload doesn't belong to this deal. Upload the model again." }, { status: 400 });
  }

  const supabase = getServiceClient();

  const { data: fileData, error: dlError } = await supabase.storage
    .from("documents")
    .download(storagePath);
  if (dlError || !fileData) {
    return NextResponse.json(
      { error: `Could not read uploaded file: ${dlError?.message ?? "not found"}` },
      { status: 500 }
    );
  }
  const buffer = Buffer.from(await fileData.arrayBuffer());

  let returnsSummary;
  try {
    returnsSummary = await parseReturnsSummary(buffer);
  } catch (err: any) {
    // Don't silently fail the whole upload -- surface the specific problem
    // (e.g. missing "Summary Table" tab) so the analyst knows this isn't a
    // standard-template file. The file stays in storage either way.
    return NextResponse.json({ error: `Could not read workbook: ${err.message}` }, { status: 422 });
  }

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      deal_id: params.id,
      doc_type: "excel",
      storage_path: storagePath,
      uploaded_by: user.email,
    })
    .select()
    .single();
  if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });

  // Next version number. Two uploads at once can read the same latest number;
  // unique(deal_id, version_number) rejects the loser, which simply re-reads
  // and takes the next one.
  let version: any = null;
  let nextVersion = 0;
  let error: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 4 && !version; attempt++) {
    const { data: latest, error: latestError } = await supabase
      .from("uw_versions")
      .select("version_number")
      .eq("deal_id", params.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) { error = latestError; break; }
    nextVersion = (latest?.version_number ?? 0) + 1;
    const res = await supabase
      .from("uw_versions")
      .insert({
        deal_id: params.id,
        version_number: nextVersion,
        excel_document_id: doc.id,
        returns_summary: returnsSummary,
        created_by: user.email,
      })
      .select()
      .single();
    version = res.data;
    error = res.error;
    if (error && error.code !== "23505") break;
  }

  if (!version) {
    // Don't leave a document row that no version points at.
    await supabase.from("documents").delete().eq("id", doc.id);
    return NextResponse.json({ error: error?.message ?? "Could not save the version" }, { status: 500 });
  }

  await logDealEvent(
    params.id,
    "uw_version_created",
    { version_number: nextVersion, warnings: returnsSummary.warnings },
    user.email
  );

  // A model in hand is what makes a deal "in UW": if this deal is still at
  // Prospect, the upload advances it. Deals already past UW (offered, PSA...)
  // are never regressed by a re-upload -- the stage filter below guarantees
  // the update only fires from Prospect.
  const { data: advanced } = await supabase
    .from("deals")
    .update({ stage: "uw" })
    .eq("id", params.id)
    .eq("deal_type", "acquisition")
    .eq("stage", "prospect")
    .select("id");
  if (advanced && advanced.length > 0) {
    await logDealEvent(params.id, "advanced_to_uw", { via: "model_upload" }, "system");
    await fireStageChangeWebhook(params.id, {
      from: "prospect",
      to: "uw",
      actor: user.email,
      via: "model_upload",
    });
  }

  // Surface parser warnings (e.g. #REF! errors, non-numeric cells) back to
  // the analyst rather than burying them -- a version with a warning still
  // saves, but the analyst should know a number might be missing.
  return NextResponse.json({ version, warnings: returnsSummary.warnings }, { status: 201 });
}
