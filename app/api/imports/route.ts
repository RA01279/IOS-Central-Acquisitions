// app/api/imports/route.ts
// The signed-in user's OM imports (New Deal > Import). Files live under the
// user's own imports/<hash>/ folder until the deal is created, when
// /api/deals/[id]/documents files them to the deal.
//   POST { action: "upload_url" }  -> { path, token }   (browser upload)
//   GET  ?path=imports/...         -> { url }           (read for text extraction)
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { IMPORT_PATH, importOwnerDir } from "@/lib/outlook-helper";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body?.action !== "upload_url") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const path = `${importOwnerDir(user.email)}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  const { data, error } = await getServiceClient().storage.from("documents").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not prepare the upload" }, { status: 500 });
  return NextResponse.json({ path: data.path, token: data.token });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!IMPORT_PATH.test(path) || !path.startsWith(importOwnerDir(user.email) + "/")) {
    return NextResponse.json({ error: "Not your import" }, { status: 403 });
  }
  const { data, error } = await getServiceClient().storage.from("documents").createSignedUrl(path, 600);
  if (error || !data) return NextResponse.json({ error: "Import expired. Upload it again." }, { status: 404 });
  return NextResponse.json({ url: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
