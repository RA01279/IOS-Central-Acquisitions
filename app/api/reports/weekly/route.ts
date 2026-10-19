// app/api/reports/weekly/route.ts
//
// GET -> the weekly pipeline report as an Excel workbook: a Summary sheet
// (pipeline by class and stage, closings, owners) and one sheet each for
// stage moves, offers, losses and the next 14 days.
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { buildWeeklyReport } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";

const MONEY = '"$"#,##0';
const NAVY = "FF1F3B4D";

function header(ws: ExcelJS.Worksheet, cols: { header: string; key: string; width: number; money?: boolean }[]) {
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : {} }));
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let r;
  try {
    r = await buildWeeklyReport();
  } catch (err: any) {
    return NextResponse.json({ error: `Report failed: ${err.message}` }, { status: 500 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Hopper";
  wb.created = new Date();

  const s = wb.addWorksheet("Summary");
  s.getColumn(1).width = 26;
  for (let c = 2; c <= 8; c++) s.getColumn(c).width = 16;
  s.addRow([`Central Acquisitions — weekly pipeline report`]).font = { bold: true, size: 14, color: { argb: NAVY } };
  s.addRow([`Week ${r.weekStart} to ${r.today} · generated ${new Date(r.generatedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT`]);
  s.addRow([]);
  for (const cls of r.snapshot) {
    const h = s.addRow([`${cls.label} pipeline`, "Deals", "Value"]);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    for (const st of cls.stages) s.addRow([st.label, st.count, st.value]).getCell(3).numFmt = MONEY;
    const t = s.addRow(["Total open", cls.total.count, cls.total.value]);
    t.font = { bold: true };
    t.getCell(3).numFmt = MONEY;
    s.addRow([]);
  }
  const ch = s.addRow(["Closings", "Deals", "Value"]);
  ch.font = { bold: true };
  s.addRow(["Month to date", r.closed.mtd.count, r.closed.mtd.value]).getCell(3).numFmt = MONEY;
  s.addRow(["Year to date", r.closed.ytd.count, r.closed.ytd.value]).getCell(3).numFmt = MONEY;
  s.addRow([]);
  s.addRow(["This week", "Count"]).font = { bold: true };
  s.addRow(["New deals", r.moves.filter((m) => m.what === "New deal").length]);
  s.addRow(["Stage moves", r.moves.filter((m) => m.what !== "New deal").length]);
  s.addRow(["Offers", r.offers.length]);
  s.addRow(["Losses (archived)", r.losses.length]);
  s.addRow(["Dates in next 14 days", r.upcoming.length]);
  s.addRow([]);
  const oh = s.addRow(["Owner", "Open deals", "Value", "In contract", "Dates next 14d"]);
  oh.font = { bold: true };
  for (const o of r.owners) s.addRow([o.owner, o.active, o.value, o.inContract, o.due]).getCell(3).numFmt = MONEY;

  const moves = wb.addWorksheet("Stage moves");
  header(moves, [
    { header: "Date", key: "date", width: 12 }, { header: "Deal", key: "address", width: 40 }, { header: "Class", key: "assetClass", width: 11 },
    { header: "Market", key: "market", width: 14 }, { header: "Move", key: "what", width: 20 }, { header: "Detail", key: "detail", width: 18 },
    { header: "By", key: "actor", width: 14 }, { header: "Owner", key: "owner", width: 16 },
  ]);
  moves.addRows(r.moves);

  const offers = wb.addWorksheet("Offers");
  header(offers, [
    { header: "Date", key: "date", width: 12 }, { header: "Deal", key: "address", width: 40 }, { header: "Class", key: "assetClass", width: 11 },
    { header: "Market", key: "market", width: 14 }, { header: "Price", key: "price", width: 15, money: true }, { header: "Status", key: "status", width: 12 },
    { header: "Counter", key: "counter", width: 15, money: true }, { header: "Owner", key: "owner", width: 16 },
  ]);
  offers.addRows(r.offers);

  const losses = wb.addWorksheet("Losses");
  header(losses, [
    { header: "Date", key: "date", width: 12 }, { header: "Deal", key: "address", width: 40 }, { header: "Class", key: "assetClass", width: 11 },
    { header: "Died at", key: "stage", width: 18 }, { header: "Reason", key: "reason", width: 50 }, { header: "Owner", key: "owner", width: 16 },
  ]);
  losses.addRows(r.losses);

  const up = wb.addWorksheet("Next 14 days");
  header(up, [
    { header: "Date", key: "date", width: 12 }, { header: "What", key: "what", width: 36 }, { header: "Deal", key: "address", width: 40 },
    { header: "Class", key: "assetClass", width: 11 }, { header: "Owner", key: "owner", width: 16 },
  ]);
  up.addRows(r.upcoming);

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Central Acquisitions weekly report ${r.today}.xlsx"`,
    },
  });
}
