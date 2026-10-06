// app/api/deals/[id]/documents/route.ts
// POST { importPath, fileName } -- file an imported OM to a deal: moves it
// out of the user's imports/ folder into deals/<id>/ and records it as an
// 'om' document.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { IMPORT_PATH, importOwnerDir } from "@/lib/outlook-helper";
import { logDealEvent } from "@/lib/deals";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid deal" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const from = String(body?.importPath ?? "");
  if (!IMPORT_PATH.test(from) || !from.startsWith(importOwnerDir(user.email) + "/")) {
    return NextResponse.json({ error: "Not your import" }, { status: 403 });
  }
  const name = String(body?.fileName ?? "OM.pdf").replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, "_").slice(0, 120) || "OM.pdf";
  const to = `deals/${id}/om-${Date.now()}-${name.toLowerCase().endsWith(".pdf") ? name : name + ".pdf"}`;
  const db = getServiceClient();
  const { error: moveError } = await db.storage.from("documents").move(from, to);
  if (moveError) return NextResponse.json({ error: `Could not file the OM: ${moveError.message}` }, { status: 500 });
  const { error } = await db.from("documents").insert({ deal_id: id, doc_type: "om", storage_path: to, uploaded_by: user.email });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logDealEvent(id, "om_attached", { file: name }, user.email).catch(() => {});
  return NextResponse.json({ ok: true, path: to }, { status: 201 });
}
