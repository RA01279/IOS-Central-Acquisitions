// app/api/deals/[id]/upload-url/route.ts
// Issues a signed storage-upload URL so the browser can push underwriting
// files DIRECTLY to Supabase Storage. Vercel caps API request bodies at
// ~4.5MB, which real underwriting models exceed (uploads were failing with
// 413) -- the file never touches this server; only the signed handshake does.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const safeName = String(body.fileName ?? "upload.xlsx").replace(/[^A-Za-z0-9._-]+/g, "_");
  const path = `deals/${params.id}/uw-${Date.now()}-${safeName}`;

  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from("documents").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  }
  return NextResponse.json({ path: data.path, token: data.token });
}
