// app/api/deals/[id]/photo-upload-url/route.ts
// Signed upload URL for a site-visit photo. Same direct-to-storage pattern as
// the underwriting upload (Vercel caps request bodies at ~4.5MB and phone
// photos exceed it): the image never passes through this server.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" };

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid deal" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const ext = EXT[String(body.contentType ?? "")];
  if (!ext) return NextResponse.json({ error: "Photos must be JPEG, PNG, HEIC or WebP" }, { status: 400 });

  const path = `deals/${id}/site-visits/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { data, error } = await getServiceClient().storage.from("documents").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });
  return NextResponse.json({ path: data.path, token: data.token });
}
