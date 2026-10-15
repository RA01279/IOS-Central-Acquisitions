// app/api/deal-portfolios/route.ts
// POST { name, sellerBroker?, currentOwner?, notes?, importPath?, fileName? }
// -- start a portfolio package: the record each site's deal will point at,
// with the OM filed once under portfolios/<id>/. The sites themselves are
// created one by one through POST /api/deals with dealPortfolioId, so one bad
// address can't sink the other thirty-nine.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { IMPORT_PATH, importOwnerDir } from "@/lib/outlook-helper";

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const name = text(body?.name, 200);
  if (!name) return NextResponse.json({ error: "Name the portfolio" }, { status: 400 });

  const db = getServiceClient();
  const { data: row, error } = await db
    .from("deal_portfolios")
    .insert({
      name,
      seller_broker: text(body.sellerBroker, 200),
      current_owner: text(body.currentOwner, 200),
      notes: Array.isArray(body.notes) ? body.notes.filter((n: unknown) => typeof n === "string").slice(0, 40).map((n: string) => n.slice(0, 400)) : [],
      created_by: user.email,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // File the OM. A failure here keeps the portfolio; the OM can be attached later.
  let omWarning: string | null = null;
  const from = String(body.importPath ?? "");
  if (from) {
    if (!IMPORT_PATH.test(from) || !from.startsWith(importOwnerDir(user.email) + "/")) {
      omWarning = "The OM wasn't yours to file, so it was skipped.";
    } else {
      const fileName = String(body.fileName ?? "OM.pdf").replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, "_").slice(0, 120) || "OM.pdf";
      const to = `portfolios/${row.id}/om-${Date.now()}-${fileName.toLowerCase().endsWith(".pdf") ? fileName : fileName + ".pdf"}`;
      const { error: moveError } = await db.storage.from("documents").move(from, to);
      if (moveError) omWarning = `Could not file the OM: ${moveError.message}`;
      else await db.from("deal_portfolios").update({ om_path: to, om_name: fileName }).eq("id", row.id);
    }
  }
  return NextResponse.json({ id: row.id, omWarning }, { status: 201 });
}
