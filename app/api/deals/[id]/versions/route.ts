import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";

// POST /api/deals/[id]/versions
// Appends a new underwriting version. Never overwrites -- see
// supabase/migrations/0002_acquisitions.sql for why.
//
// TODO(claude-code): this is where the Excel-reading step goes once
// Jadon's template is available -- read the uploaded workbook, extract
// return metrics into returns_summary, store the file via documents
// table (doc_type: "excel"), then insert the version row below.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const supabase = getServiceClient();

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
      excel_document_id: body.excelDocumentId ?? null,
      returns_summary: body.returnsSummary ?? {},
      created_by: user.email,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logDealEvent(params.id, "uw_version_created", { version_number: nextVersion }, user.email);

  // First version created -> advance to uw_v1 and this is where Rhett
  // gets notified, per the spec's step 5.
  if (nextVersion === 1) {
    await supabase.from("deals").update({ stage: "uw_v1" }).eq("id", params.id);
    // TODO(claude-code): send the actual notification once Graph
    // Mail.Send is wired up (see lib/auth.ts scope comment).
  }

  return NextResponse.json({ version }, { status: 201 });
}
