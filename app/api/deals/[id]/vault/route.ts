// app/api/deals/[id]/vault/route.ts
//
// The deal's document vault. Files go straight from the browser to Storage
// on a signed URL (Vercel's ~4.5 MB body cap), then are registered here.
//
// POST   { action: "upload-url", fileName }            -> { path, token }
// POST   { action: "register", path, fileName, docType, milestoneId?, markDone?, activityId? }
// GET    ?doc=<id>                                     -> redirect to a 5-minute signed link
// PATCH  { docId, docType?, milestoneId? }
// DELETE { docId }
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { logDealEvent } from "@/lib/deals";
import { DOC_TYPE_LABELS } from "@/lib/diligence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = /\.(pdf|docx?|xlsx|xlsm|xls|csv|pptx|jpe?g|png|tiff?|heic|msg|eml|zip|txt|kmz|dwg)$/i;
const MAX_BYTES = 100 * 1024 * 1024;
// Model versions own their workbook rows; they're managed from Financials.
const UNDELETABLE = new Set(["excel"]);

const ctToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function safeName(v: unknown) {
  return String(v ?? "file").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "").slice(-120) || "file";
}

async function guard(req: NextRequest, id: string) {
  const user = await getCurrentUser(req);
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!UUID.test(id)) return { error: NextResponse.json({ error: "Deal not found" }, { status: 404 }) };
  const { data } = await getServiceClient().from("deals").select("id").eq("id", id).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "Deal not found" }, { status: 404 }) };
  return { user };
}

async function milestoneOnDeal(dealId: string, milestoneId: unknown) {
  if (milestoneId == null || milestoneId === "") return null;
  if (!UUID.test(String(milestoneId))) throw new Error("Unknown milestone");
  const { data } = await getServiceClient()
    .from("deal_milestones").select("id, label, done_on").eq("id", milestoneId).eq("deal_id", dealId).maybeSingle();
  if (!data) throw new Error("That milestone isn't on this deal");
  return data;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const user = g.user!;
  const body = await req.json().catch(() => ({}));
  const db = getServiceClient();

  if (body.action === "upload-url") {
    const name = safeName(body.fileName);
    if (!ALLOWED.test(name)) {
      return NextResponse.json({ error: "That file type isn't accepted. Upload a PDF, Office file, image, email or zip." }, { status: 400 });
    }
    const path = `deals/${id}/doc-${Date.now()}-${name}`;
    const { data, error } = await db.storage.from("documents").createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not start the upload" }, { status: 500 });
    return NextResponse.json({ path: data.path, token: data.token });
  }

  if (body.action === "register") {
    const path = String(body.path ?? "");
    const prefix = `deals/${id}/doc-`;
    const base = path.slice(`deals/${id}/`.length);
    if (!path.startsWith(prefix) || !/^[A-Za-z0-9._-]+$/.test(base)) {
      return NextResponse.json({ error: "That upload doesn't belong to this deal" }, { status: 400 });
    }
    const docType = String(body.docType ?? "");
    if (!DOC_TYPE_LABELS[docType] || docType === "excel") return NextResponse.json({ error: "Choose what kind of document this is" }, { status: 400 });
    let milestone: any = null;
    try { milestone = await milestoneOnDeal(id, body.milestoneId); } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // A file attached to a note on Notes & History: the note must be this deal's.
    let activityId: string | null = null;
    if (body.activityId) {
      if (!UUID.test(String(body.activityId))) return NextResponse.json({ error: "Unknown note" }, { status: 400 });
      const { data: act } = await db.from("activities").select("id").eq("id", body.activityId).eq("deal_id", id).maybeSingle();
      if (!act) return NextResponse.json({ error: "That note isn't on this deal" }, { status: 400 });
      activityId = act.id;
    }
    // The file must really be there, and within the size limit.
    const { data: listed, error: listError } = await db.storage.from("documents").list(`deals/${id}`, { search: base, limit: 5 });
    const obj = listed?.find((o: any) => o.name === base);
    if (listError || !obj) return NextResponse.json({ error: "The upload didn't arrive. Try again." }, { status: 400 });
    const size = Number((obj as any).metadata?.size ?? 0) || null;
    if (size && size > MAX_BYTES) {
      await db.storage.from("documents").remove([path]);
      return NextResponse.json({ error: "Files are limited to 100 MB" }, { status: 400 });
    }
    const fileName = String(body.fileName ?? base).slice(0, 200);
    const { data: doc, error } = await db
      .from("documents")
      .insert({ deal_id: id, doc_type: docType, storage_path: path, uploaded_by: user.email, file_name: fileName, size_bytes: size, milestone_id: milestone?.id ?? null, activity_id: activityId })
      .select("id")
      .single();
    if (error) {
      await db.storage.from("documents").remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (milestone && body.markDone === true && !milestone.done_on) {
      await db.from("deal_milestones").update({ done_on: ctToday(), updated_at: new Date().toISOString() }).eq("id", milestone.id);
    }
    await logDealEvent(id, "document_uploaded", { type: docType, file: fileName, milestone: milestone?.label ?? null, note: activityId }, user.email);
    return NextResponse.json({ ok: true, id: doc.id }, { status: 201 });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const docId = req.nextUrl.searchParams.get("doc") ?? "";
  if (!UUID.test(docId)) return NextResponse.json({ error: "Missing document" }, { status: 400 });
  const db = getServiceClient();
  const { data: doc } = await db.from("documents").select("storage_path, file_name").eq("id", docId).eq("deal_id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found on this deal" }, { status: 404 });
  const name = doc.file_name || doc.storage_path.split("/").pop();
  const { data, error } = await db.storage.from("documents").createSignedUrl(doc.storage_path, 300, { download: name });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not open the file" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.docId ?? ""))) return NextResponse.json({ error: "Missing document" }, { status: 400 });
  const update: Record<string, unknown> = {};
  if ("docType" in body) {
    if (!DOC_TYPE_LABELS[body.docType] || body.docType === "excel") return NextResponse.json({ error: "Unknown document type" }, { status: 400 });
    update.doc_type = body.docType;
  }
  if ("milestoneId" in body) {
    try { update.milestone_id = (await milestoneOnDeal(id, body.milestoneId))?.id ?? null; } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const { data, error } = await getServiceClient()
    .from("documents").update(update).eq("id", body.docId).eq("deal_id", id).neq("doc_type", "excel").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Document not found on this deal" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const user = g.user!;
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.docId ?? ""))) return NextResponse.json({ error: "Missing document" }, { status: 400 });
  const db = getServiceClient();
  const { data: doc } = await db.from("documents").select("id, doc_type, storage_path, file_name").eq("id", body.docId).eq("deal_id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found on this deal" }, { status: 404 });
  if (UNDELETABLE.has(doc.doc_type)) return NextResponse.json({ error: "Model workbooks belong to their UW version and stay." }, { status: 400 });
  const { error } = await db.from("documents").delete().eq("id", doc.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Only this deal's own files are removed from storage. A portfolio OM is
  // shared by every site in the package, and other rows may point at it.
  if (doc.storage_path.startsWith(`deals/${id}/`)) {
    const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("storage_path", doc.storage_path);
    if (!count) await db.storage.from("documents").remove([doc.storage_path]);
  }
  await logDealEvent(id, "document_removed", { type: doc.doc_type, file: doc.file_name ?? doc.storage_path.split("/").pop() }, user.email);
  return NextResponse.json({ ok: true });
}
