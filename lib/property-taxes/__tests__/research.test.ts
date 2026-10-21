import {it,expect,vi} from "vitest";
import {researchTaxes,texasParcel,texasIdentify} from "../research";
import {emptyTaxState} from "../types";
import {source} from "./fixtures";
// Public State Capitol parcel. Official TxGIO identify response retrieved 2026-10-21.
// DATE_ACQ is data acquisition metadata, not ownership/assessment timing.
const officialCapitol={PROP_ID:"197003",GEO_ID:"0208030201",OWNER_NAME:"STATE OF TEXAS",LEGAL_DESC:"CAPITOL SQUARE",MKT_VALUE:"266787500",SITUS_ADDR:"W 11 ST, , TX 78701",COUNTY:"TRAVIS",TAX_YEAR:"2026",DATE_ACQ:"46204"};
it("parses a representative official roll without inventing assessed value, exemptions or bills",()=>{
  const parsed=texasParcel(officialCapitol,{address:"1100 Congress Avenue",state:"TX"},source)!;
  expect(parsed.market).toBe(266787500);expect(parsed.year).toBe(2026);expect(parsed.parcel.accountId).toBe("197003");
  expect(parsed.parcel.review).toBe("pending");expect(parsed.parcel.matchEvidence.join(" ")).toContain("differs");
  expect(texasIdentify(30.2747,-97.7404)).toContain("/identify?");
  expect(texasParcel({...officialCapitol,TAX_YEAR:"Null"},{address:"x"},source)?.year).toBeNull();
});
it("streams partial Texas findings, preserves raw evidence and discloses missing five-year bills/payment records",async()=>{
  const fetcher=vi.fn(async(input:any)=>{
    const u=String(input);
    if(u.includes("census.gov"))return Response.json({result:{geographies:{Counties:[{NAME:"Travis County"}],States:[{STUSAB:"TX"}]}}});
    if(u.includes("/identify"))return Response.json({results:[{attributes:officialCapitol}]});
    return new Response("<html>Official rules: January 1 market valuation. Rate per $100.</html>");
  });
  const progress:string[]=[];
  const report=await researchTaxes({address:"1100 Congress Avenue",latitude:30.2747,longitude:-97.7404,precision:"manual",state:"TX"},emptyTaxState(),message=>progress.push(message),fetcher as any);
  expect(progress.length).toBeGreaterThan(2);expect(report.records).toHaveLength(1);
  expect(Object.keys(report.records[0].facts)).toEqual(["market"]);expect(report.research?.status).toBe("partial");
  expect(report.research?.gaps.join(" ")).toContain("five-year history");expect(report.sources.some(s=>s.evidence.includes("266787500"))).toBe(true);
  expect(fetcher.mock.calls.every(([url])=>!String(url).includes("example.gov"))).toBe(true);
});
it("does not treat undated Gwinnett tax master amounts as current taxes",async()=>{
  const fetcher=vi.fn(async(input:any)=>{
    const u=String(input);
    if(u.includes("census.gov"))return Response.json({result:{geographies:{Counties:[{NAME:"Gwinnett County"}],States:[{STUSAB:"GA"}]}}});
    if(u.includes("/0/query"))return Response.json({features:[{attributes:{TAXPIN:"TEST-1",PIN:"TEST-1",ADDRESS:"100 Main Road"}}]});
    if(u.includes("/3/query"))return Response.json({features:[{attributes:{RPIN:"R6250 010",PIN:"6250 010",LOCADDR:"100 Main Road",TOTVAL1:100000,TAXTOT1:950}}]});
    return new Response("<html>Official assessment rules</html>");
  });
  const report=await researchTaxes({address:"100 Main Road",latitude:33.9,longitude:-84.1,precision:"manual",state:"GA"},emptyTaxState(),()=>{},fetcher as any);
  expect(report.parcels).toHaveLength(1);expect(report.records).toHaveLength(0);
  expect(report.sources.some(s=>s.evidence.includes("TAXTOT1"))).toBe(true);
  expect(report.research?.gaps.join(" ")).toContain("undated figures");
});
it("records access failures and unconnected jurisdictions without bypassing or making up values",async()=>{
  const denied=vi.fn(async()=>new Response("Access denied",{status:403}));
  const report=await researchTaxes({address:"100 Main Road",latitude:29.8,longitude:-95.4,precision:"manual",state:"TX"},emptyTaxState(),()=>{},denied as any);
  expect(report.records).toHaveLength(0);expect(report.rules).toHaveLength(0);expect(report.research?.gaps.join(" ")).toContain("inaccessible");
  const unsupported=await researchTaxes({address:"100 Main Road",latitude:35,longitude:-82,precision:"manual",state:"NC"},emptyTaxState(),()=>{},denied as any);
  expect(unsupported.research?.gaps.join(" ")).toContain("not connected");
});
