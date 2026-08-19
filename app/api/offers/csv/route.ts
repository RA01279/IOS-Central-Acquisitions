// app/api/offers/csv/route.ts
// The offer log as a CSV download, same filters as /offers. Auth-gated by the
// middleware (this path is not in the exclusion list), so it's the signed-in
// team only -- the token-guarded /api/export is the machine-readable door.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { ctToday, isRangeKey, rangeStart } from "@/lib/summary";

export const dynamic = "force-dynamic";

// Excel treats a leading =, +, -, or @ as a formula. Prefix those with a
// single quote so an address like "-- see notes" can't execute anything.
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const assetParam = req.nextUrl.searchParams.get("asset");
  const asset =
    assetParam && (ASSET_CLASSES as readonly string[]).includes(assetParam) ? assetParam : "all";
  const rangeParam = req.nextUrl.searchParams.get("range");
  const range = isRangeKey(rangeParam) ? rangeParam : "ytd";
  const today = ctToday();
  const start = rangeStart(range, today);

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("offers")
    .select(
      "id, price, offered_at, notes, source, created_by, deals(id, deal_type, stage, asset_class, properties(address, city, market, submarket, lot_sf, building_sf))"
    )
    .gte("offered_at", start)
    .order("offered_at", { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).filter((o: any) => {
    if (!o.deals || o.deals.deal_type === "lease") return false;
    if (asset !== "all" && o.deals.asset_class !== asset) return false;
    return true;
  });

  const header = [
    "offer_date",
    "address",
    "city",
    "market",
    "submarket",
    "asset_class",
    "price",
    "land_psf",
    "lot_sf",
    "building_sf",
    "stage",
    "source",
    "logged_by",
    "notes",
    "deal_url",
  ];

  const lines = [header.join(",")];
  for (const o of rows as any[]) {
    const p = o.deals.properties ?? {};
    const psf = o.price && p.lot_sf ? (o.price / p.lot_sf).toFixed(2) : "";
    lines.push(
      [
        o.offered_at,
        p.address,
        p.city,
        p.market,
        p.submarket,
        ASSET_CLASS_LABELS[o.deals.asset_class] ?? o.deals.asset_class,
        o.price,
        psf,
        p.lot_sf,
        p.building_sf,
        STAGE_LABELS[o.deals.stage] ?? o.deals.stage,
        o.source,
        o.created_by,
        o.notes,
        `https://ios-central-acquisitions.vercel.app/deals/${o.deals.id}`,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  const fileName = `offer-log-${asset}-${range}-${today}.csv`;
  // Leading BOM so Excel opens this as UTF-8 rather than mangling accented
  // names in the broker/owner columns.
  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
