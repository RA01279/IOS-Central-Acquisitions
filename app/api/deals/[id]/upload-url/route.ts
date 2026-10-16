// app/api/deals/[id]/upload-url/route.ts
// Issues a signed storage-upload URL so the browser can push underwriting
// files DIRECTLY to Supabase Storage. Vercel caps API request bodies at
// ~4.5MB, which real underwriting models exceed (uploads were failing with
// 413) -- the file never touches this server; only the signed handshake does.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKBOOK = /\.(xlsx|xlsm)$/i;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Only underwriting workbooks, only onto a real deal: the versions route
  // trusts paths of exactly this shape and nothing else.
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Unknown deal" }, { status: 404 });
  const body = await req.json();
  const safeName = String(body.fileName ?? "upload.xlsx").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  if (!WORKBOOK.test(safeName)) {
    return NextResponse.json({ error: "Upload the model as an .xlsx or .xlsm workbook" }, { status: 400 });
  }
  const supabase = getServiceClient();
  const { data: deal } = await supabase.from("deals").select("id").eq("id", params.id).maybeSingle();
  if (!deal) return NextResponse.json({ error: "Unknown deal" }, { status: 404 });
  const path = `deals/${params.id}/uw-${Date.now()}-${safeName}`;

  const { data, error } = await supabase.storage.from("documents").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  }
  return NextResponse.json({ path: data.path, token: data.token });
}
