import { beforeEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { renderToStaticMarkup } from "react-dom/server";
import { acquisitionBrief, briefPct } from "./acquisition-brief";
import { acquisitionBriefPdf } from "./acquisition-brief-pdf";
import { parseReturnsSummary } from "./excel-parser";
const state = vi.hoisted(() => ({ auth: true, deal: null as any }));
vi.mock("./auth", () => ({ getCurrentUser: async () => state.auth ? { email: "fixture@test" } : null }));
vi.mock("./deal-workspace", () => ({ getDeal: async () => state.deal }));
vi.mock("./supabase", () => ({ getServiceClient: () => ({ from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.deal, error: null }) }; return q; } }) }));
import { GET } from "../app/api/deals/[id]/acquisition-brief/route";
import Page from "../app/deals/[id]/acquisition-brief/page";
const version = (id = "v1", n = 1, address = "100 Test Road") => ({ id, deal_id: "a", version_number: n, created_at: "2026-11-18T12:00:00Z", excel_document_id: "doc1",
  returns_summary: { sourceProperty: address, purchasePrice: 3000000, allInCost: 3400000, irrPct: -.05, equityMultiple: .9, goingInYieldPct: 0, stabilizedReturnOnCostPct: .08, exitCapPct: .06, holdPeriodYears: 4, stabilizedCashOnCashPct: 0, warnings: [] },
  model_detail: { uw: { fileName: "Fixture.xlsx", year1Noi: 100000, recoveriesYear1: 25000, capexByYear: [0, 50000], rentRoll: [{ tenant: "Fixture Tenant", rentAnnual: 120000, marketAnnual: 150000, start: "2025-01-01", expiration: "2028-12-31" }] } } });
const deal = () => ({ id: "a", deal_type: "acquisition", asset_class: "ios", stage: "uw", properties: { address: "100 Test Road", building_sf: 7500, lot_sf: 43560 }, uw_versions: [version()], documents: [], mla_data: [] });
beforeEach(() => { state.auth = true; state.deal = deal(); });
it("requires a model and refreshes to the latest upload while allowing historical selection", () => {
  expect(() => acquisitionBrief({ ...deal(), uw_versions: [] })).toThrow(/Upload/);
  const d = deal(); d.uw_versions.push(version("v2", 2));
  expect(acquisitionBrief(d).versionId).toBe("v2"); expect(acquisitionBrief(d, "v1").historical).toBe(true);
  expect(() => acquisitionBrief(d, "other-deal")).toThrow(/does not belong/);
});
it("separates reimbursements, model assumptions and recorded facts, preserving zero and negative units", () => {
  const b = acquisitionBrief(deal());
  expect(b.metrics[2].value).toBe("-5.00%"); expect(briefPct(0)).toBe("0.00%");
  expect(b.assumptions.find(r => r.label === "Year 1 NOI")?.value).toBe("$100,000");
  expect(b.assumptions.find(r => r.label === "Expense reimbursements")?.value).toContain("$25,000");
  expect(b.facts.find(r => r.label === "Lease page / section")?.value).toContain("Not verified");
});
it("does not reuse another deal's version, and labels incomplete data", () => {
  const d = deal(); d.id = "b"; expect(() => acquisitionBrief(d)).toThrow(/Upload/);
  d.uw_versions = [{ id: "b1", deal_id: "b", version_number: 1 } as any];
  const b = acquisitionBrief(d); expect(b.metrics.every(r => r.value === "Not available")).toBe(true); expect(b.warnings.length).toBeGreaterThan(0);
});
it.each(["ios", "industrial"])("uses the normal %s workbook parser's saved return units", async template => {
  const wb = new ExcelJS.Workbook();
  if(template === "industrial") {
    const s = wb.addWorksheet("_Upload_");
    ["Purchase Price", "Total Sources", "In-Place Cap on PP", "Stab cap-on-all-in (Yield to Cost)", "Exit Cap with adj", "Last sale", "Gross IRR Lev", "Gross Equity Mult.", "Lev Avg CoC"].forEach((label,i) => { s.getCell(`B${i+1}`).value=label; s.getCell(`C${i+1}`).value=[3000000,3400000,0,.08,.06,48,-.05,.9,0][i]; });
  } else {
    const s=wb.addWorksheet("Pro Forma"); s.getCell("F7").value="Levered";
    [[8,"IRR","F",-.05],[10,"Multiple","F",.9],[11,"Avg. Cash-on-Cash","F",0],[16,"Address","F","100 Test Road"],[33,"Purchase Price","F",3000000],[54,"Total Uses","F",3400000],[77,"Going-in Cap Rate (tax adj.)","C",0],[81,"Yield on Cost at Exit","C",.08],[151,"Month of Sale","D",48],[168,"Exit Cap","F",.06]].forEach(([row,label,col,value]) => { s.getCell(`B${row}`).value=label as string; s.getCell(`${col}${row}`).value=value as any; });
  }
  const summary=await parseReturnsSummary(Buffer.from(await wb.xlsx.writeBuffer()),"100 Test Road");
  const d=deal(); d.uw_versions[0].returns_summary=summary as any;
  const b=acquisitionBrief(d); expect(b.metrics[2].value).toBe("-5.00%");expect(b.returns[1].value).toBe(0);
  expect((await PDFDocument.load(await acquisitionBriefPdf(b))).getPageCount()).toBe(1);
});
it("renders saved-version preview and handles no model without a second upload", async () => {
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({id:"a"}),searchParams:Promise.resolve({})}));
  expect(html).toContain("acquisition-brief?version=v1");expect(html).toContain("Fixture.xlsx");expect(html).not.toContain('type="file"');
  state.deal.uw_versions=[];expect(renderToStaticMarkup(await Page({params:Promise.resolve({id:"a"}),searchParams:Promise.resolve({})}))).toContain("Upload an underwriting model");
});
it("authenticates exports, pins versions and returns a one-page PDF with private caching", async () => {
  const req=(query="")=>({nextUrl:new URL("https://example.test/api?"+query)}) as any;
  state.auth=false;expect((await GET(req(),{params:Promise.resolve({id:"a"})})).status).toBe(401);
  state.auth=true;expect((await GET(req("version=other"),{params:Promise.resolve({id:"a"})})).status).toBe(404);
  const response=await GET(req("version=v1&download=1"),{params:Promise.resolve({id:"a"})});expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("no-store");expect(response.headers.get("content-disposition")).toContain("attachment");expect((await PDFDocument.load(await response.arrayBuffer())).getPageCount()).toBe(1);
});
