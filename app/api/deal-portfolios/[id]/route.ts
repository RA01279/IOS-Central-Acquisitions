// app/api/deal-portfolios/[id]/route.ts
//
// A portfolio package as a whole, with the same rules as one deal
// (lib/deal-archive), applied to every site:
// POST { action: "archive", reason, disposition?, pursuitScore?, followUpOn? }
//        -> archive every site that isn't already archived or closed
// POST { action: "restore" }  -> restore every archived site to where it died
// DELETE                      -> delete every site and the portfolio itself
//
// Delete is all or nothing: if any site can't be deleted (closed, or under
// contract for someone who isn't a PSA signer), nothing is deleted and the
// blockers are listed. Archive and restore report per site.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { archiveDeal, deleteBlocker, deleteDeal, restoreDeal } from "@/lib/deal-archive";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sites(id: string) {
  const db = getServiceClient();
  const { data: pf } = await db.from("deal_portfolios").select("id, name, om_path").eq("id", id).maybeSingle();
  if (!pf) return null;
  const { data: deals, error } = await db
    .from("deals")
    .select("id, ref, stage, property_id, portfolio_asset_id, properties(address)")
    .eq("deal_portfolio_id", id);
  if (error) throw new Error(error.message);
  return { pf, deals: (deals ?? []) as any[] };
}
const label = (d: any) => `D-${d.ref} ${d.properties?.address ?? ""}`.trim();

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad portfolio id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const found = await sites(id);
  if (!found) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  if (body.action === "archive") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "Give a reason for archiving" }, { status: 400 });
    const todo = found.deals.filter((d) => d.stage !== "archived" && d.stage !== "closed");
    const skipped = found.deals.filter((d) => d.stage === "closed").map((d) => `${label(d)}: closed, kept`);
    const failed: string[] = [];
    for (const d of todo) {
      const out = await archiveDeal(d.id, { reason: `${reason} (portfolio: ${found.pf.name})`, disposition: body.disposition, pursuitScore: body.pursuitScore, followUpOn: body.followUpOn }, user.email);
      if (!out.ok) failed.push(`${label(d)}: ${out.error}`);
    }
    return NextResponse.json({ archived: todo.length - failed.length, skipped, failed });
  }

  if (body.action === "restore") {
    const todo = found.deals.filter((d) => d.stage === "archived");
    const failed: string[] = [];
    for (const d of todo) {
      const out = await restoreDeal(d.id, user.email);
      if (!out.ok) failed.push(`${label(d)}: ${out.error}`);
    }
    return NextResponse.json({ restored: todo.length - failed.length, failed });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad portfolio id" }, { status: 400 });
  const found = await sites(id);
  if (!found) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  const blockers = found.deals.map((d) => [d, deleteBlocker(d, user.email)] as const).filter(([, b]) => b);
  if (blockers.length) {
    return NextResponse.json({ error: `Nothing was deleted. ${blockers.map(([d, b]) => `${label(d)}: ${b}`).join(" ")}` }, { status: 409 });
  }
  const warnings: string[] = [];
  for (const d of found.deals) {
    const out = await deleteDeal(d);
    if (!out.ok) return NextResponse.json({ error: `Stopped at ${label(d)}: ${out.error}. Sites before it were deleted.` }, { status: 500 });
    if (out.warning) warnings.push(out.warning);
  }
  const db = getServiceClient();
  const { error } = await db.from("deal_portfolios").delete().eq("id", id);
  if (error) return NextResponse.json({ error: `Sites deleted, but the portfolio record remains: ${error.message}` }, { status: 500 });
  // The filed OM goes with it; a failure only leaves a harmless orphan file.
  if (found.pf.om_path) await db.storage.from("documents").remove([found.pf.om_path]).catch(() => {});
  return NextResponse.json({ ok: true, deleted: found.deals.length, warnings });
}
