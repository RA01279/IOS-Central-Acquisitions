// app/api/contacts/[id]/split/route.ts
//
// POST { firm: { companyId } | { name } | null, people: [{ name, email?, phone? }] }
//
// Turns one contact record that holds a whole broker team into one contact
// per person. People already in Hopper (same name) are reused, not
// duplicated. Every deal the record was linked to is linked to each person in
// the same role. The record itself becomes the first person -- or, when that
// person already exists, is merged into them (links, notes and tasks move
// over) and removed.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max) || null;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const people = (Array.isArray(body.people) ? body.people : [])
    .map((p: any) => ({ name: clean(p.name, 120), email: clean(p.email, 200), phone: clean(p.phone, 40) }))
    .filter((p: any) => p.name);
  if (!people.length) return NextResponse.json({ error: "List at least one person" }, { status: 400 });
  for (const p of people) if (p.email && !EMAIL.test(p.email)) return NextResponse.json({ error: `${p.name}: that email doesn't look right` }, { status: 400 });
  const lower = people.map((p: any) => p.name.toLowerCase());
  if (new Set(lower).size !== lower.length) return NextResponse.json({ error: "A person is listed twice" }, { status: 400 });

  const db = getServiceClient();
  const { data: record } = await db.from("contacts").select("id, name, email, phone, company_id, contact_type").eq("id", id).maybeSingle();
  if (!record) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // The firm: an existing company, or one found / created by name.
  let companyId: string | null = record.company_id ?? null;
  if (body.firm?.companyId) {
    if (!UUID.test(String(body.firm.companyId))) return NextResponse.json({ error: "Unknown firm" }, { status: 400 });
    companyId = body.firm.companyId;
  } else if (body.firm?.name) {
    const name = clean(body.firm.name, 120)!;
    const { data: found } = await db.from("companies").select("id").ilike("name", name).maybeSingle();
    if (found) companyId = found.id;
    else {
      const { data: made, error } = await db.from("companies").insert({ name, company_type: "broker" }).select("id").single();
      if (error) return NextResponse.json({ error: `Creating ${name}: ${error.message}` }, { status: 500 });
      companyId = made.id;
    }
  }

  const { data: links } = await db.from("deal_contacts").select("deal_id, role").eq("contact_id", id);
  const linkTo = async (contactId: string) => {
    for (const l of links ?? []) {
      const { error } = await db.from("deal_contacts").insert({ deal_id: l.deal_id, contact_id: contactId, role: l.role });
      if (error && error.code !== "23505") throw new Error(error.message); // already linked is fine
    }
  };
  // Fill in what the person is missing; never overwrite what's there.
  const fill = async (contactId: string, p: any, current: any) => {
    const update: Record<string, unknown> = {};
    if (p.email && !current?.email) update.email = p.email;
    if (p.phone && !current?.phone) update.phone = p.phone;
    if (companyId && !current?.company_id) update.company_id = companyId;
    if (!current?.contact_type) update.contact_type = "broker";
    if (Object.keys(update).length) await db.from("contacts").update(update).eq("id", contactId);
  };

  const result: { name: string; contactId: string; how: "kept" | "merged" | "existing" | "created" }[] = [];
  try {
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const { data: existing } = await db.from("contacts").select("id, email, phone, company_id, contact_type").ilike("name", p.name).neq("id", id).limit(1).maybeSingle();
      if (i === 0) {
        if (existing) {
          // Merge this record into the person who already exists.
          await linkTo(existing.id);
          await db.from("activities").update({ contact_id: existing.id }).eq("contact_id", id);
          await db.from("tasks").update({ contact_id: existing.id }).eq("contact_id", id);
          await fill(existing.id, p, existing);
          result.push({ name: p.name, contactId: existing.id, how: "merged" });
        } else {
          const { error } = await db.from("contacts").update({
            name: p.name,
            email: record.email ?? p.email,
            phone: record.phone ?? p.phone,
            company_id: companyId,
            contact_type: record.contact_type ?? "broker",
          }).eq("id", id);
          if (error) throw new Error(error.message);
          result.push({ name: p.name, contactId: id, how: "kept" });
        }
        continue;
      }
      if (existing) {
        await linkTo(existing.id);
        await fill(existing.id, p, existing);
        result.push({ name: p.name, contactId: existing.id, how: "existing" });
      } else {
        const { data: made, error } = await db.from("contacts")
          .insert({ name: p.name, email: p.email, phone: p.phone, company_id: companyId, contact_type: "broker" })
          .select("id").single();
        if (error) throw new Error(`${p.name}: ${error.message}`);
        await linkTo(made.id);
        result.push({ name: p.name, contactId: made.id, how: "created" });
      }
    }
    // The record was merged away: its links now live on the people.
    if (result[0]?.how === "merged") await db.from("contacts").delete().eq("id", id);
  } catch (err: any) {
    return NextResponse.json({ error: `Stopped part-way: ${err.message}. Already done: ${result.map((r) => r.name).join(", ") || "nothing"}.`, done: result }, { status: 500 });
  }
  return NextResponse.json({ ok: true, people: result });
}
