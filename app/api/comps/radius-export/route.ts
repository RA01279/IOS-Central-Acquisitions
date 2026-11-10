// app/api/comps/radius-export/route.ts
//
// GET ?address=&miles=&type=lease|sale|both&class=all|ios|industrial
//   -> an Excel workbook of the confirmed comps within that radius of the
//      address, nearest first: one sheet per comp type plus a Search sheet
//      saying what was asked and where the address landed. Every row links to
//      the Google Maps satellite view of the comp and to the comp in Hopper.
// Errors come back as JSON ({ error }) so the form can show them.
// The response headers X-Lease-Count / X-Sale-Count / X-Matched-Address let
// the form say what it found without opening the file.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { geocodeDetailed } from "@/lib/geocode";
import { readAllCompPages } from "@/lib/comps/mapData";
import { aerialUrl, compsWithin, parseRadiusQuery } from "@/lib/comps/radius";
import { rateSummary, rateViews } from "@/lib/comps/rates";

export const dynamic = "force-dynamic";

const NAVY = "FF0A2540";
const LINK = { color: { argb: "FF0E5AA7" }, underline: true } as const;
const COLUMNS =
  "id, comp_type, status, address, city, state, market, submarket, asset_class, latitude, longitude, geocode_precision, is_portfolio, portfolio_transaction_id, " +
  "building_sf, lot_sf, yard_acres, rent, rent_basis, date_commenced, lease_term_months, lease_type, escalations_pct, free_rent_months, ti_psf, tenant_name, landlord_name, " +
  "sale_price, closed_on, cap_rate, buyer, seller, source, notes";

type Col = { header: string; key: string; width: number; fmt?: string };

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

const acres = (sf: unknown) => (sf != null && Number(sf) > 0 ? Number(sf) / 43560 : null);
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
// Percents are stored either way (3.5 or 0.035); Excel wants the fraction.
const pct = (v: unknown) => { const x = num(v); return x == null ? null : x > 1 ? x / 100 : x; };
const date = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : null);

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = parseRadiusQuery({ address: sp.get("address"), miles: sp.get("miles"), type: sp.get("type"), class: sp.get("class") });
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 });

  // The centre of a search circle only has to be roughly right, so Google's
  // best match is taken even when the address is ambiguous (a building and its
  // parking lot) -- but a match no finer than a county, state or the country
  // is a failed lookup, not a centre.
  const geo = await geocodeDetailed([q.address]);
  if (!geo.result) return NextResponse.json({ error: `Couldn't place that address: ${geo.reason}` }, { status: 422 });
  const types = geo.result.types ?? [];
  const tooCoarse = ["country", "administrative_area_level_1", "administrative_area_level_2"].some((t) => types.includes(t)) &&
    !types.some((t) => ["locality", "postal_code", "neighborhood", "sublocality", "street_address", "premise", "route"].includes(t));
  if (tooCoarse) return NextResponse.json({ error: `Couldn't place that address closer than ${geo.result.formatted}. Add the street, city and state.` }, { status: 422 });
  const center = { lat: geo.result.lat, lng: geo.result.lng };
  const streetLevel = geo.result.precision === "rooftop" || geo.result.precision === "range_interpolated" || types.includes("street_address") || types.includes("premise");

  const db = getServiceClient();
  let comps: any[];
  try {
    comps = await readAllCompPages<any>((from, to) =>
      db.from("comps").select(COLUMNS).eq("status", "confirmed").not("latitude", "is", null).order("id").range(from, to) as any
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Loading comps: ${err.message}` }, { status: 500 });
  }

  const found = compsWithin(comps, center, q.miles, q.type, q.assetClass);
  const leases = found.filter((c) => c.comp_type === "lease");
  const sales = found.filter((c) => c.comp_type === "sale");
  const origin = req.nextUrl.origin;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Hopper";
  const where = (c: any) => ({
    distance: Math.round(c.distanceMiles * 100) / 100,
    address: c.address,
    city: c.city,
    state: c.state,
    market: c.market,
    submarket: c.submarket,
    assetClass: c.asset_class === "ios" ? "IOS" : c.asset_class === "industrial" ? "Industrial" : c.asset_class,
    buildingSf: num(c.building_sf),
    landAc: acres(c.lot_sf),
    yardAc: num(c.yard_acres),
    portfolio: c.portfolio_transaction_id ? "Portfolio site (allocated price)" : null,
    source: c.source,
  });
  const linkCells = (ws: ExcelJS.Worksheet, row: ExcelJS.Row, c: any) => {
    row.getCell("aerial").value = { text: "Aerial", hyperlink: aerialUrl(c.lat, c.lng) };
    row.getCell("aerial").font = LINK;
    row.getCell("hopper").value = { text: "Open in Hopper", hyperlink: `${origin}/comps/${c.portfolio_transaction_id || c.id}` };
    row.getCell("hopper").font = LINK;
  };
  const whereCols: Col[] = [
    { header: "Miles", key: "distance", width: 8, fmt: "0.00" },
    { header: "Address", key: "address", width: 32 },
    { header: "City", key: "city", width: 16 },
    { header: "State", key: "state", width: 7 },
    { header: "Market", key: "market", width: 14 },
    { header: "Submarket", key: "submarket", width: 16 },
    { header: "Class", key: "assetClass", width: 11 },
  ];
  const sizeCols: Col[] = [
    { header: "Building SF", key: "buildingSf", width: 12, fmt: "#,##0" },
    { header: "Land acres", key: "landAc", width: 11, fmt: "0.00" },
    { header: "Yard acres", key: "yardAc", width: 11, fmt: "0.00" },
  ];
  const tailCols: Col[] = [
    { header: "Aerial", key: "aerial", width: 9 },
    { header: "Hopper", key: "hopper", width: 15 },
    { header: "Note", key: "portfolio", width: 28 },
    { header: "Source", key: "source", width: 24 },
  ];

  if (q.type !== "sale") {
    const ws = sheet(wb, "Lease comps", [
      ...whereCols,
      { header: "Tenant", key: "tenant", width: 22 },
      { header: "Landlord", key: "landlord", width: 22 },
      { header: "Commenced", key: "commenced", width: 12 },
      { header: "Term (mo)", key: "term", width: 10 },
      { header: "Rent as quoted", key: "quoted", width: 22 },
      { header: "$/AC/mo", key: "perAcre", width: 11, fmt: "$#,##0" },
      { header: "$/SF bldg/mo", key: "perSf", width: 13, fmt: "$#,##0.00" },
      { header: "Total $/mo", key: "total", width: 12, fmt: "$#,##0" },
      { header: "Lease type", key: "leaseType", width: 11 },
      { header: "Escalations", key: "esc", width: 12, fmt: "0.0#%" },
      { header: "Free rent (mo)", key: "free", width: 12 },
      { header: "TI $/SF", key: "ti", width: 9, fmt: "$#,##0.00" },
      ...sizeCols,
      ...tailCols,
    ]);
    for (const c of leases) {
      const v = rateViews(c);
      const row = ws.addRow({
        ...where(c),
        tenant: c.tenant_name,
        landlord: c.landlord_name,
        commenced: date(c.date_commenced),
        term: num(c.lease_term_months),
        quoted: rateSummary(c) || null,
        perAcre: v.perAcreMonthly,
        perSf: v.perSfBldgMonthly,
        total: v.totalMonthly,
        leaseType: c.lease_type,
        esc: pct(c.escalations_pct),
        free: num(c.free_rent_months),
        ti: num(c.ti_psf),
      });
      linkCells(ws, row, c);
    }
  }

  if (q.type !== "lease") {
    const ws = sheet(wb, "Sale comps", [
      ...whereCols,
      { header: "Closed", key: "closed", width: 12 },
      { header: "Sale price", key: "price", width: 14, fmt: "$#,##0" },
      { header: "$/SF bldg", key: "perSf", width: 11, fmt: "$#,##0.00" },
      { header: "$/AC land", key: "perAcre", width: 12, fmt: "$#,##0" },
      { header: "Cap rate", key: "cap", width: 9, fmt: "0.00%" },
      { header: "Buyer", key: "buyer", width: 22 },
      { header: "Seller", key: "seller", width: 22 },
      ...sizeCols,
      ...tailCols,
    ]);
    for (const c of sales) {
      const price = num(c.sale_price);
      const bldg = num(c.building_sf);
      const land = acres(c.lot_sf);
      const cap = num(c.cap_rate);
      const row = ws.addRow({
        ...where(c),
        closed: date(c.closed_on),
        price,
        perSf: price && bldg ? price / bldg : null,
        perAcre: price && land ? price / land : null,
        // Stored as a percent (6.5) or a fraction (0.065); Excel wants the fraction.
        cap: pct(cap),
        buyer: c.buyer,
        seller: c.seller,
      });
      linkCells(ws, row, c);
    }
  }

  const s = wb.addWorksheet("Search");
  s.columns = [{ key: "k", width: 22 }, { key: "v", width: 60 }];
  s.addRows([
    { k: "Address searched", v: q.address },
    { k: "Matched to", v: `${geo.result.formatted ?? `${center.lat}, ${center.lng}`}${streetLevel ? "" : " (approximate: distances are from this point)"}` },
    { k: "Radius", v: `${q.miles} miles` },
    { k: "Comp types", v: q.type === "both" ? "Lease and sale" : q.type === "lease" ? "Lease" : "Sale" },
    { k: "Asset class", v: q.assetClass === "all" ? "All" : q.assetClass === "ios" ? "IOS" : "Industrial" },
    { k: "Found", v: `${leases.length} lease, ${sales.length} sale` },
    { k: "Exported", v: `${today} by ${user.email}` },
    { k: "Included", v: "Confirmed comps with a measurable location. Portfolio totals are left out; a portfolio's individual sites are included and marked." },
  ]);
  s.getColumn("k").font = { bold: true };
  const subject = s.addRow({ k: "Subject aerial", v: { text: "Open in Google Maps", hyperlink: aerialUrl(center.lat, center.lng) } });
  subject.getCell("v").font = LINK;

  const slug = q.address.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "address";
  const file = `Comps-${q.miles}mi-${slug}-${today}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "X-Lease-Count": String(leases.length),
      "X-Sale-Count": String(sales.length),
      "X-Matched-Address": encodeURIComponent(geo.result.formatted ?? ""),
      "X-Matched-Approximate": streetLevel ? "0" : "1",
    },
  });
}
