import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";
import { parseReturnsSummary } from "@/lib/excel-parser";

// POST /api/deals/[id]/versions
// multipart/form-data with an "excel" file field. Reads the workbook's
// "Summary Table" tab, stores the raw file, and appends a new version
// row -- never overwrites a prior version.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("excel") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing excel file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let returnsSummary;
  try {
    returnsSummary = await parseReturnsSummary(buffer);
  } catch (err: any) {
    // Don't silently fail the whole upload -- surface the specific
    // problem (e.g. missing "Summary Table" tab) so the analyst knows
    // this isn't a standard-template file.
    return NextResponse.json({ error: `Could not read workbook: ${err.message}` }, { status: 422 });
  }

  const supabase = getServiceClient();

  const storagePath = `deals/${params.id}/uw-${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({ deal_id: params.id, doc_type: "excel", storage_path: storagePath, uploaded_by: user.email })
    .select()
    .single();
  if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });

  const { data: latest } = await supabase
    .from("uw_versions")
    .select("version_number")
    .eq("deal_id", params.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version_number ?? 0) + 1;

  const { data: version, error } = await supabase
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
  }

  // Surface parser warnings (e.g. #REF! errors, non-numeric cells) back
  // to the analyst rather than burying them -- a version with a warning
  // still saves, but the analyst should know a number might be missing.
  return NextResponse.json({ version, warnings: returnsSummary.warnings }, { status: 201 });
}
