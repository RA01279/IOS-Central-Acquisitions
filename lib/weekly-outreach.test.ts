import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWeeklyOutreach } from "./weekly-outreach";
import { addWeeklyOutreachSheet } from "./weekly-outreach-excel";

const build = (overrides: Partial<Parameters<typeof buildWeeklyOutreach>[0]> = {}) => buildWeeklyOutreach({
  weekStart: "2026-11-10", today: "2026-11-16", outreachDeals: [], touches: [], reminders: [], events: [],
  dealInfo: new Map(), nameOf: (email) => email ?? "Unassigned", ...overrides,
});
const touch = (occurred_at: string, outcome: string | null = "spoke", activity_type = "call") => ({
  deal_id: "a", activity_type, outcome, occurred_at, created_by: "Alex", body: "Owner wants to talk",
});

describe("weekly outreach", () => {
  it("counts Chicago calendar days and keeps overdue-only people", () => {
    const r = build({ touches: [touch("2026-11-10T05:59:59Z"), touch("2026-11-10T06:00:00Z"), touch("2026-11-17T05:59:59Z", "no_answer", "email"), touch("2026-11-17T06:00:00Z")],
      reminders: [{ deal_id: "a", assigned_to: "Sam", due_date: "2026-11-15" }, { deal_id: "a", assigned_to: "Alex", due_date: "2026-11-16" }] });
    expect(r.totals).toEqual({ touches: 2, reached: 1, overdue: 1 });
    expect(r.byPerson.find((p) => p.person === "Sam")).toMatchObject({ touches: 0, overdue: 1 });
  });
  it("retains old warm owners, sorts touches, and chooses the earliest reminder", () => {
    const r = build({ outreachDeals: [{ id: "a", address: "1 Main", city: "Dallas", owner: "Owner" }],
      touches: [touch("2026-01-01T15:00:00Z", "interested"), touch("2026-11-12T15:00:00Z", "no_answer")],
      reminders: [{ deal_id: "a", assigned_to: "Alex", due_date: "2026-11-20" }, { deal_id: "a", assigned_to: "Alex", due_date: "2026-11-18" }] });
    expect(r.warm[0]).toMatchObject({ status: "talking", nextOn: "2026-11-18", lastTouch: { on: "2026-11-12" } });
  });
  it("uses daylight saving time for summer weeks", () => {
    const r = build({ weekStart: "2026-07-01", today: "2026-07-07",
      touches: [touch("2026-07-01T04:59:59Z"), touch("2026-07-01T05:00:00Z")] });
    expect(r.totals.touches).toBe(1);
  });
  it("limits movements to the week and separates parked outreach from pipeline losses", () => {
    const event = (event_type: string, created_at: string, stage = "outreach") => ({ deal_id: "a", event_type, created_at, actor: "Alex", detail: { stage, reason: "Not now", follow_up: "2027-02-01" } });
    const r = build({ events: [event("moved_to_pipeline", "2026-11-12T15:00:00Z"), event("moved_to_pipeline", "2026-11-09T15:00:00Z"), event("archived", "2026-11-13T15:00:00Z"), event("archived", "2026-11-13T15:00:00Z", "uw")], dealInfo: new Map([["a", { address: "1 Main", followUpOn: null }]]) });
    expect(r.moved).toHaveLength(1);
    expect(r.parked).toEqual([{ id: "a", address: "1 Main", on: "2026-11-13", reason: "Not now", checkBackOn: "2027-02-01" }]);
  });
  it("round-trips outreach data through a real Excel workbook", async () => {
    const r = build({ touches: [touch("2026-11-12T15:00:00Z")], outreachDeals: [{ id: "a", address: "1 Main", city: "Dallas", owner: "Owner" }] });
    const wb = new ExcelJS.Workbook();
    addWeeklyOutreachSheet(wb, r, "2026-11-10", "2026-11-16");
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await wb.xlsx.writeBuffer());
    const rows: unknown[] = [];
    loaded.getWorksheet("Outreach")!.eachRow((row) => rows.push(row.values));
    expect(JSON.stringify(rows)).toContain("1 Main");
    expect(JSON.stringify(rows)).toContain("Alex");
    expect(loaded.getWorksheet("Outreach")!.getCell("B3").value).toBe(1);
  });
});
