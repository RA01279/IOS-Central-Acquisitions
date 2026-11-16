import type ExcelJS from "exceljs";
import type { WeeklyOutreach } from "./weekly-outreach";

/** Keep the export and report page on the same outreach data model. */
export function addWeeklyOutreachSheet(wb: ExcelJS.Workbook, outreach: WeeklyOutreach, weekStart: string, today: string) {
  const ws = wb.addWorksheet("Outreach");
  [40, 24, 24, 24, 24, 24, 24, 24, 24].forEach((width, i) => { ws.getColumn(i + 1).width = width; });
  ws.addRow(["Off-Market Outreach"]).font = { bold: true, size: 14, color: { argb: "FF0A2540" } };
  ws.addRow([`Week ${weekStart} to ${today} · America/Chicago`]);
  ws.addRow(["Owner touches", outreach.totals.touches, "Reached an owner", outreach.totals.reached, "Overdue follow-ups", outreach.totals.overdue]);
  const section = (columns: string[]) => {
    ws.addRow([]);
    const row = ws.addRow(columns);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A2540" } };
  };
  section(["Activity by Person", "Touches", "Calls", "Emails", "Letters", "Other", "Reached an owner", "Overdue follow-ups"]);
  for (const p of outreach.byPerson) ws.addRow([p.person, p.touches, p.calls, p.emails, p.letters, p.other, p.reached, p.overdue]);
  if (!outreach.byPerson.length) ws.addRow(["No owner touches or overdue follow-ups."]);
  section(["Owners Contacted This Week", "Owner / contact", "Date", "Method", "Outcome", "By", "Notes", "Next follow-up"]);
  for (const t of outreach.touches) ws.addRow([t.address, t.owner ?? "Owner not recorded", t.on, t.method, t.outcome ?? "Outcome not recorded", t.by, t.note, t.nextOn]);
  if (!outreach.touches.length) ws.addRow(["No owner touches logged this week."]);
  section(["Warm Owners", "City", "Owner", "Status", "Last touch date", "Last touch", "Notes", "Next touch"]);
  for (const w of outreach.warm) ws.addRow([w.address, w.city, w.owner, w.statusLabel, w.lastTouch?.on, w.lastTouch?.what, w.lastTouch?.note, w.nextOn]);
  if (!outreach.warm.length) ws.addRow(["No owners in conversation or interested right now."]);
  section(["Moved to Pipeline", "Date", "By"]);
  for (const m of outreach.moved) ws.addRow([m.address, m.on, m.by]);
  if (!outreach.moved.length) ws.addRow(["None this week."]);
  section(["Parked from Outreach", "Date", "Reason", "Check back"]);
  for (const p of outreach.parked) ws.addRow([p.address, p.on, p.reason, p.checkBackOn]);
  if (!outreach.parked.length) ws.addRow(["None this week."]);
  ws.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}
