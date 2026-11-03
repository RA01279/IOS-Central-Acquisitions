// app/api/exec-summaries/outbox/route.ts
//
// The Hopper helper's delivery queue for automatic executive summaries.
// GET  -> decks this helper's owner built in the last 14 days that haven't
//         been copied to the deal folder yet, each with a short-lived link.
// POST { documentId, path?, outcome } -> records the copy (or why it didn't happen)
//         so the deck isn't offered again.

import { NextRequest } from "next/server";
import { workerContext, json } from "@/lib/agents/server";
import { UUID } from "@/lib/agents/catalog";
import { logDealEvent } from "@/lib/deals";
import { BUILT_EVENT, DELIVERED_EVENT } from "@/lib/ic-deck/auto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await workerContext(req); if (!ctx) return json({ error: "Pairing expired." }, 401);
  const { db, helper } = ctx;
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [built, done] = await Promise.all([
    db.from("deal_events").select("deal_id,detail,created_at").eq("event_type", BUILT_EVENT).eq("actor", helper.owner_email)
      .gte("created_at", since).order("created_at", { ascending: true }).limit(50),
    db.from("deal_events").select("detail").eq("event_type", DELIVERED_EVENT).eq("actor", helper.owner_email).gte("created_at", since).limit(500),
  ]);
  if (built.error || done.error) return json({ error: "Outbox unavailable." }, 500);
  const delivered = new Set((done.data ?? []).map((e: any) => e.detail?.documentId));
  const pending = (built.data ?? []).filter((e: any) => e.detail?.documentId && !delivered.has(e.detail.documentId)).slice(0, 10);
  const items = [];
  for (const e of pending as any[]) {
    const [{ data: doc }, { data: deal }] = await Promise.all([
      db.from("documents").select("storage_path,file_name").eq("id", e.detail.documentId).eq("deal_id", e.deal_id).maybeSingle(),
      db.from("deals").select("properties(address, city)").eq("id", e.deal_id).maybeSingle(),
    ]);
    if (!doc) continue;
    const prop: any = Array.isArray(deal?.properties) ? deal!.properties[0] : deal?.properties;
    const { data: link } = await db.storage.from("documents").createSignedUrl(doc.storage_path, 600);
    if (!link) continue;
    items.push({ documentId: e.detail.documentId, dealId: e.deal_id, fileName: doc.file_name ?? e.detail.fileName, address: prop?.address ?? null, city: prop?.city ?? null, url: link.signedUrl });
  }
  return json({ items });
}

export async function POST(req: NextRequest) {
  const ctx = await workerContext(req); if (!ctx) return json({ error: "Pairing expired." }, 401);
  const { db, helper } = ctx;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.documentId !== "string" || !UUID.test(body.documentId)
    || !["saved", "exists", "no_folder", "failed"].includes(body.outcome)
    || (body.path != null && (typeof body.path !== "string" || body.path.length > 500))) return json({ error: "Invalid delivery." }, 400);
  const { data: built } = await db.from("deal_events").select("deal_id").eq("event_type", BUILT_EVENT).eq("actor", helper.owner_email)
    .contains("detail", { documentId: body.documentId }).limit(1).maybeSingle();
  if (!built) return json({ error: "Unknown deck." }, 404);
  // "no_folder" and "failed" are recorded too, so a deal without a folder isn't retried forever.
  await logDealEvent(built.deal_id, DELIVERED_EVENT, { documentId: body.documentId, outcome: body.outcome, path: body.path ?? null, note: typeof body.note === "string" ? body.note.slice(0, 300) : null }, helper.owner_email);
  return json({ ok: true });
}
