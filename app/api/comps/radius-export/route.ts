// app/api/comps/radius-export/route.ts
//
// GET ?address=&miles=&type=lease|sale|both&class=all|ios|industrial
//   -> an Excel workbook of the confirmed comps within that radius of the
//      address, nearest first. Sheets: Summary (the search, where the address
//      landed, counts and medians), then Lease comps and/or Sale comps. Every
//      comp row links to the Google Maps satellite view and back to Hopper.
// Repeats of one deal (the same workbook imported twice, an email and a
// workbook describing one lease) are merged into one row by lib/comps/radius
// dedupeComps, using the same rule comp intake flags duplicates with.
// Errors come back as JSON ({ error }) so the form can show them; the
// X-Lease-Count / X-Sale-Count / X-Merged / X-Matched-* headers let the form
// say what it found without opening the file.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { geocodeDetailed } from "@/lib/geocode";
import { readAllCompPages } from "@/lib/comps/mapData";
import { aerialUrl, compsWithin, dedupeComps, parseRadiusQuery } from "@/lib/comps/radius";
import { rateSummary, rateViews } from "@/lib/comps/rates";

export const dynamic = "force-dynamic";

// Dalfen navy / brand blue, a light band for alternate rows.
const NAVY = "FF0A2540";
const BRAND = "FF0E5AA7";
const BAND = "FFF3F6F9";
const RULE = "FFDDE4EB";
const LINK_FONT = { color: { argb: BRAND }, underline: true } as const;

const COLUMNS =
  "id, comp_type, status, address, suite, project_name, city, state, market, submarket, asset_class, latitude, longitude, geocode_precision, is_portfolio, portfolio_transaction_id, created_at, " +
  "building_sf, lot_sf, yard_acres, rent, rent_basis, date_commenced, lease_term_months, lease_type, escalations_pct, free_rent_months, ti_psf, tenant_name, landlord_name, " +
  "sale_price, closed_on, cap_rate, buyer, seller, source";

type Col = { header: string; key: string; width: number; fmt?: string; align?: "left" | "center" | "right" };

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const acres = (sf: unknown) => { const x = num(sf); return x && x > 0 ? x / 43560 : null; };
// Percents are stored either way (3.5 or 0.035); Excel wants the fraction.
const pct = (v: unknown) => { const x = num(v); return x == null ? null : x > 1 ? x / 100 : x; };
// Real Excel dates (noon UTC, so no time zone shifts the day).
const xdate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00Z`) : null);
const median = (xs: (number | null)[]) => {
  const s = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const usd = (v: number | null, dp = 0) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const classLabel = (c: string | null) => (c === "ios" ? "IOS" : c === "industrial" ? "Industrial" : c ?? "");

/** A comp sheet: title block, navy header, banded rows, frozen header and address. */
function compSheet(wb: ExcelJS.Workbook, name: string, title: string, subtitle: string, cols: Col[], rows: Record<string, unknown>[], links: { aerial: string; hopper: string }[]) {
  const ws = wb.addWorksheet(name, {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4", margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: "&L&8Hopper · Central Acquisitions&R&8Page &P of &N" },
  });
  // Wide enough for the header's longest word plus Excel's filter button.
  ws.columns = cols.map((c) => ({ key: c.key, width: Math.max(c.width, Math.max(...c.header.split(" ").map((w) => w.length)) + 5) }));
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF4C5966" } };
  ws.getRow(3).height = 6;

  const head = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 0 };
  });
  head.height = 30;

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.height = 18;
    cols.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      if (c.fmt) cell.numFmt = c.fmt;
      cell.alignment = { vertical: "middle", horizontal: c.align ?? (c.fmt ? "right" : "left") };
      cell.font = { size: 10 };
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
    });
    const a = row.getCell("aerial"), h = row.getCell("hopper");
    a.value = { text: "Aerial", hyperlink: links[i].aerial };
    a.font = { ...LINK_FONT, size: 10 };
    h.value = { text: "Open", hyperlink: links[i].hopper };
    h.font = { ...LINK_FONT, size: 10 };
  });

  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 4, topLeftCell: "C5" }];
  if (rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: cols.length } };
  else ws.getCell("A5").value = "No comps of this type in the radius.";
  return ws;
}

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
  const matched = geo.result.formatted ?? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;

  const db = getServiceClient();
  let comps: any[];
  try {
    comps = await readAllCompPages<any>((from, to) =>
      db.from("comps").select(COLUMNS).eq("status", "confirmed").not("latitude", "is", null).order("id").range(from, to) as any
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Loading comps: ${err.message}` }, { status: 500 });
  }

  const inside = compsWithin(comps, center, q.miles, q.type, q.assetClass);
  const found = dedupeComps(inside);
  const merged = inside.length - found.length;
  const leases = found.filter((c) => c.comp_type === "lease");
  const sales = found.filter((c) => c.comp_type === "sale");
  const origin = req.nextUrl.origin;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const todayLong = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  const classText = q.assetClass === "all" ? "IOS and industrial" : classLabel(q.assetClass);
  const links = (list: any[]) => list.map((c) => ({ aerial: aerialUrl(c.lat, c.lng), hopper: `${origin}/comps/${c.portfolio_transaction_id || c.id}` }));
  const note = (c: any) =>
    [c.portfolio_transaction_id ? "Portfolio site (allocated price)" : null, c.mergedFrom.length ? `Merged ${c.mergedFrom.length + 1} records` : null].filter(Boolean).join(" · ") || null;
  const place = (c: any) => ({
    miles: Math.round(c.distanceMiles * 10) / 10,
    address: [c.address, c.suite ? `Ste ${c.suite}` : null].filter(Boolean).join(", "),
    city: [c.city, c.state].filter(Boolean).join(", ") || null,
    submarket: c.submarket ?? c.market ?? null,
    assetClass: classLabel(c.asset_class),
    buildingSf: num(c.building_sf),
    landAc: acres(c.lot_sf),
    yardAc: num(c.yard_acres),
    note: note(c),
  });
  const placeCols: Col[] = [
    { header: "Miles", key: "miles", width: 7, fmt: "0.0" },
    { header: "Address", key: "address", width: 34 },
    { header: "City", key: "city", width: 16 },
    { header: "Submarket", key: "submarket", width: 16 },
    { header: "Class", key: "assetClass", width: 10 },
  ];
  const sizeCols: Col[] = [
    { header: "Bldg SF", key: "buildingSf", width: 10, fmt: "#,##0" },
    { header: "Land AC", key: "landAc", width: 9, fmt: "0.00" },
    { header: "Yard AC", key: "yardAc", width: 9, fmt: "0.00" },
  ];
  const tailCols: Col[] = [
    { header: "Aerial", key: "aerial", width: 8, align: "center" },
    { header: "Hopper", key: "hopper", width: 8, align: "center" },
    { header: "Note", key: "note", width: 26 },
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = "Hopper";
  wb.created = new Date();
  const summary = wb.addWorksheet("Summary", { properties: { tabColor: { argb: NAVY } } });

  // Rents and prices on comparable bases, for the sheets and the summary.
  const leaseRows = leases.map((c) => {
    const v = rateViews(c);
    return {
      ...place(c),
      tenant: c.tenant_name ?? null,
      landlord: c.landlord_name ?? null,
      commenced: xdate(c.date_commenced),
      term: num(c.lease_term_months),
      perAcre: v.perAcreMonthly,
      perSf: v.perSfBldgMonthly,
      total: v.totalMonthly,
      quoted: rateSummary(c) || null,
      leaseType: c.lease_type ? String(c.lease_type).toUpperCase() : null,
      esc: pct(c.escalations_pct),
      free: num(c.free_rent_months),
      ti: num(c.ti_psf),
    };
  });
  const saleRows = sales.map((c) => {
    const price = num(c.sale_price), bldg = num(c.building_sf), land = acres(c.lot_sf);
    return {
      ...place(c),
      closed: xdate(c.closed_on),
      price,
      perSf: price && bldg ? price / bldg : null,
      perAcre: price && land ? price / land : null,
      cap: pct(c.cap_rate),
      buyer: c.buyer ?? null,
      seller: c.seller ?? null,
    };
  });

  const lead = (n: number, kind: string) => `${n} ${kind} comp${n === 1 ? "" : "s"} within ${q.miles} mi of ${matched}`;
  if (q.type !== "sale") {
    const medAc = median(leaseRows.map((r) => r.perAcre)), medSf = median(leaseRows.map((r) => r.perSf));
    compSheet(wb, "Lease comps", `Lease comps · ${q.miles} mi of ${q.address}`,
      `${lead(leaseRows.length, "lease")} · ${classText} · median ${usd(medAc)}/AC/mo, ${usd(medSf, 2)}/SF/mo · exported ${todayLong}`,
      [
        ...placeCols,
        { header: "Tenant", key: "tenant", width: 22 },
        { header: "Commenced", key: "commenced", width: 11, fmt: "mmm yyyy" },
        { header: "Term (mo)", key: "term", width: 8, fmt: "0" },
        { header: "$/AC/mo", key: "perAcre", width: 10, fmt: "$#,##0" },
        { header: "$/SF/mo", key: "perSf", width: 9, fmt: "$0.00" },
        { header: "Total $/mo", key: "total", width: 11, fmt: "$#,##0" },
        { header: "Rent as quoted", key: "quoted", width: 24 },
        { header: "Lease type", key: "leaseType", width: 9, align: "center" },
        { header: "Esc.", key: "esc", width: 7, fmt: "0.0%" },
        { header: "Free rent (mo)", key: "free", width: 9, fmt: "0" },
        { header: "TI $/SF", key: "ti", width: 8, fmt: "$0.00" },
        { header: "Landlord", key: "landlord", width: 20 },
        ...sizeCols,
        ...tailCols,
      ],
      leaseRows, links(leases));
  }
  if (q.type !== "lease") {
    const medAc = median(saleRows.map((r) => r.perAcre)), medSf = median(saleRows.map((r) => r.perSf));
    compSheet(wb, "Sale comps", `Sale comps · ${q.miles} mi of ${q.address}`,
      `${lead(saleRows.length, "sale")} · ${classText} · median ${usd(medAc)}/AC, ${usd(medSf, 2)}/SF · exported ${todayLong}`,
      [
        ...placeCols,
        { header: "Closed", key: "closed", width: 10, fmt: "mmm yyyy" },
        { header: "Sale price", key: "price", width: 13, fmt: "$#,##0" },
        { header: "$/AC land", key: "perAcre", width: 12, fmt: "$#,##0" },
        { header: "$/SF bldg", key: "perSf", width: 10, fmt: "$#,##0.00" },
        { header: "Cap rate", key: "cap", width: 8, fmt: "0.00%" },
        { header: "Buyer", key: "buyer", width: 22 },
        { header: "Seller", key: "seller", width: 22 },
        ...sizeCols,
        ...tailCols,
      ],
      saleRows, links(sales));
  }

  // Summary: what was asked, where it landed, what came back.
  summary.columns = [{ key: "k", width: 24 }, { key: "v", width: 70 }];
  summary.getCell("A1").value = `Comps within ${q.miles} miles`;
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: NAVY } };
  summary.getCell("A2").value = q.address;
  summary.getCell("A2").font = { size: 11, color: { argb: "FF4C5966" } };
  const line = (k: string, v: ExcelJS.CellValue, bold = false) => {
    const r = summary.addRow({ k, v });
    r.getCell("k").font = { bold: true, size: 10, color: { argb: "FF4C5966" } };
    r.getCell("v").font = { size: 10, bold };
    r.getCell("v").alignment = { wrapText: true, vertical: "top", horizontal: "left" };
    return r;
  };
  summary.addRow({});
  line("Matched to", streetLevel ? matched : `${matched} (approximate: distances are measured from this point)`);
  const subj = line("Subject aerial", { text: "Open in Google Maps", hyperlink: aerialUrl(center.lat, center.lng) });
  subj.getCell("v").font = { ...LINK_FONT, size: 10 };
  line("Radius", `${q.miles} miles`);
  line("Asset class", classText);
  summary.addRow({});
  if (q.type !== "sale") {
    line("Lease comps", leaseRows.length, true);
    line("  Median $/AC/mo", usd(median(leaseRows.map((r) => r.perAcre))));
    line("  Median $/SF/mo", usd(median(leaseRows.map((r) => r.perSf)), 2));
  }
  if (q.type !== "lease") {
    line("Sale comps", saleRows.length, true);
    line("  Median $/AC land", usd(median(saleRows.map((r) => r.perAcre))));
    line("  Median $/SF bldg", usd(median(saleRows.map((r) => r.perSf)), 2));
  }
  summary.addRow({});
  line("Duplicates merged", merged ? `${merged} repeat record${merged === 1 ? "" : "s"} folded into the comps they repeat (marked in Note)` : "None found");
  line("Included", "Confirmed comps with a measurable location, nearest first. Portfolio totals are left out; a portfolio's individual sites are included and marked.");
  line("Exported", `${todayLong} by ${user.email.split("@")[0]}`);
  summary.views = [{ showGridLines: false }];

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
      "X-Merged": String(merged),
      "X-Matched-Address": encodeURIComponent(matched),
      "X-Matched-Approximate": streetLevel ? "0" : "1",
    },
  });
}
