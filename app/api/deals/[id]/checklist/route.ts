// app/api/deals/[id]/checklist/route.ts
//
// The closing checklist, and importing counsel's "Critical Dates and Closing
// Checklist" Word file (already uploaded to the vault as type 'checklist').
//
// POST { action: "preview", docId }                     -> what the file holds
// POST { action: "apply", docId, dates, checklist, price, fillSchedule }
// POST { action: "add", section?, item }
// PATCH { itemId, done?, status?, notes?, responsible? }
// DELETE { itemId }
import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { logDealEvent } from "@/lib/deals";
import { parseChecklistDocx } from "@/lib/checklist-docx";
import { generateSchedule, syncDealDates } from "@/lib/diligence-db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Template milestones whose date is also the deal's own column.
const DEAL_COLUMN: Record<string, string> = { psa_effective: "psa_effective_on", dd_end: "dd_end_on", closing: "closing_on" };

async function readDoc(dealId: string, docId: unknown) {
  if (!UUID.test(String(docId ?? ""))) throw new Error("Upload the checklist first");
  const db = getServiceClient();
  const { data: doc } = await db.from("documents").select("id, storage_path, file_name").eq("id", docId).eq("deal_id", dealId).maybeSingle();
  if (!doc) throw new Error("That file isn't on this deal");
  if (!/\.docx$/i.test(doc.storage_path)) throw new Error("Import reads Word (.docx) checklists. For a PDF, enter the dates on the schedule.");
  const { data, error } = await db.storage.from("documents").download(doc.storage_path);
  if (error || !data) throw new Error("Couldn't open the file");
  let xml: string;
  try {
    xml = new PizZip(Buffer.from(await data.arrayBuffer())).file("word/document.xml")?.asText() ?? "";
  } catch {
    throw new Error("That isn't a readable Word document");
  }
  const parsed = parseChecklistDocx(xml);
  if (!parsed.dates.length && !parsed.checklist.length) throw new Error("No critical-dates or closing-checklist table found in this document");
  return { doc, parsed };
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const db = getServiceClient();
  const { data: deal } = await db.from("deals").select("id, contract_price, psa_effective_on, dd_end_on, closing_on").eq("id", id).maybeSingle();
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  try {
    if (body.action === "preview") {
      const { parsed } = await readDoc(id, body.docId);
      return NextResponse.json({ ...parsed, current: { contractPrice: deal.contract_price, psaEffectiveOn: deal.psa_effective_on, ddEndOn: deal.dd_end_on, closingOn: deal.closing_on } });
    }

    if (body.action === "apply") {
      const { doc, parsed } = await readDoc(id, body.docId);
      const at = (k: string) => parsed.dates.find((d) => d.key === k && d.due_on)?.due_on ?? null;
      let datesSet = 0, itemsAdded = 0, itemsUpdated = 0;

      if (body.dates !== false && parsed.dates.length) {
        // Lay out the standard schedule from the contract's own dates first,
        // so title, survey, Phase I and the rest are there too; the
        // checklist's dates then override the template's.
        const psa = at("psa_effective") ?? deal.psa_effective_on;
        if (body.fillSchedule !== false && psa) {
          await generateSchedule(id, { psaEffectiveOn: psa, ddEndOn: at("dd_end"), closingOn: at("closing") }, user.email);
        }
        const { data: existing } = await db.from("deal_milestones").select("id, key, label").eq("deal_id", id);
        const dealCols: Record<string, unknown> = {};
        for (const d of parsed.dates) {
          if (!d.due_on) continue;
          const notes = [d.notes, `From ${doc.file_name ?? "the closing checklist"}`].filter(Boolean).join("\n").slice(0, 2000);
          const match = (existing ?? []).find((m: any) => (d.key && m.key === d.key) || (!d.key && !m.key && m.label.toLowerCase() === d.label.toLowerCase()));
          if (match) {
            const { error } = await db.from("deal_milestones").update({ label: d.label, due_on: d.due_on, notes, updated_at: new Date().toISOString() }).eq("id", match.id);
            if (error) throw new Error(error.message);
          } else {
            const { error } = await db.from("deal_milestones").insert({ deal_id: id, key: d.key, label: d.label, due_on: d.due_on, notes, sort_order: d.key ? 5 : 1000, created_by: user.email });
            if (error) throw new Error(error.message);
          }
          if (d.key && DEAL_COLUMN[d.key]) dealCols[DEAL_COLUMN[d.key]] = d.due_on;
          datesSet++;
        }
        if (Object.keys(dealCols).length) {
          const { error } = await db.from("deals").update(dealCols).eq("id", id);
          if (error) throw new Error(error.message);
          await syncDealDates(id);
        }
      }

      if (body.checklist !== false && parsed.checklist.length) {
        const { data: have } = await db.from("deal_checklist_items").select("id, section, item, done").eq("deal_id", id);
        const key = (s: string, i: string) => `${s.toLowerCase()}|${i.toLowerCase()}`;
        const byKey = new Map((have ?? []).map((h: any) => [key(h.section, h.item), h]));
        let order = 0;
        for (const c of parsed.checklist) {
          order += 10;
          const h: any = byKey.get(key(c.section, c.item));
          const row = { responsible: c.responsible, signatories: c.signatories, status: c.status, updated_at: new Date().toISOString() };
          if (h) {
            // Ticked in Hopper stays ticked; the file can only add "done".
            const { error } = await db.from("deal_checklist_items").update({ ...row, done: h.done || c.done }).eq("id", h.id);
            if (error) throw new Error(error.message);
            itemsUpdated++;
          } else {
            const { error } = await db.from("deal_checklist_items").insert({ ...row, deal_id: id, section: c.section, item: c.item, done: c.done, sort_order: order, created_by: user.email });
            if (error) throw new Error(error.message);
            itemsAdded++;
          }
        }
      }

      // The contract price, only when the deal has none -- a recorded price is never overwritten.
      let priceSet = false;
      if (body.price !== false && parsed.price && !deal.contract_price) {
        const { error } = await db.from("deals").update({ contract_price: parsed.price }).eq("id", id);
        if (error) throw new Error(error.message);
        priceSet = true;
      }
      await logDealEvent(id, "checklist_imported", { file: doc.file_name, dates: datesSet, added: itemsAdded, updated: itemsUpdated, price: priceSet ? parsed.price : null }, user.email);
      return NextResponse.json({ ok: true, datesSet, itemsAdded, itemsUpdated, priceSet });
    }

    if (body.action === "add") {
      const item = String(body.item ?? "").trim();
      if (!item || item.length > 300) return NextResponse.json({ error: "Name the item (up to 300 characters)" }, { status: 400 });
      const section = String(body.section ?? "").trim().slice(0, 120) || "General";
      const { error } = await db.from("deal_checklist_items").insert({ deal_id: id, section, item, sort_order: 10000, created_by: user.email });
      if (error) return NextResponse.json({ error: error.code === "23505" ? "That item is already on the checklist" : error.message }, { status: 400 });
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.itemId ?? ""))) return NextResponse.json({ error: "Missing item" }, { status: 400 });
  const update: Record<string, unknown> = {};
  if ("done" in body) update.done = body.done === true;
  for (const [k, max] of [["status", 200], ["notes", 2000], ["responsible", 120]] as const) {
    if (k in body) {
      const v = String(body[k] ?? "").trim();
      if (v.length > max) return NextResponse.json({ error: `${k} is limited to ${max} characters` }, { status: 400 });
      update[k] = v || null;
    }
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  update.updated_at = new Date().toISOString();
  const { data, error } = await getServiceClient().from("deal_checklist_items").update(update).eq("id", body.itemId).eq("deal_id", id).select("id, item");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Item not found on this deal" }, { status: 404 });
  if (update.done === true) await logDealEvent(id, "checklist_item_done", { item: data[0].item }, user.email);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.itemId ?? ""))) return NextResponse.json({ error: "Missing item" }, { status: 400 });
  const { data, error } = await getServiceClient().from("deal_checklist_items").delete().eq("id", body.itemId).eq("deal_id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Item not found on this deal" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
