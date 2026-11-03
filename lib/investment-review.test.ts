import {describe,it,expect} from "vitest";
import ExcelJS from "exceljs";
import {authoritativeReturns,incomePosition,modelIdentity,parseInvestmentReview,canExportModel} from "./investment-review";
import {parseReturnsSummary} from "./excel-parser";
const deal=()=>({properties:{address:"3000 Amwiler Rd",city:"Atlanta",building_sf:40000,lot_sf:3.78*43560,occupancy_status:"vacant"},uw_versions:[{id:"v1",version_number:1,returns_summary:{irrPct:.07185,sourceIdentity:{address:"1301-1347 Lathrop",city:"Houston",acres:1.92,buildingSf:9460}}}]});
describe("source authority and current income",()=>{
 it("keeps a confirmed wrong upload rejected after the deal is edited to match it",()=>{
  const d:any=deal(),checked=modelIdentity(d);
  d.uw_versions[0].returns_summary.identityResolution={fingerprint:checked.fingerprint,outcome:"wrong_upload",actor:"analyst",at:"2026-10-30",reason:"Original attachment is for another property"};
  d.properties={address:"1301-1347 Lathrop",city:"Houston",building_sf:9460,lot_sf:1.92*43560};
  expect(modelIdentity(d).state).toBe("wrong_upload");expect(authoritativeReturns(d)).toBeNull();
  expect(canExportModel(d,{address:"1301-1347 Lathrop",acres:1.92,buildingSf:9460},"original.xlsx",4000000,.07185)).toBe(false);
  expect(modelIdentity(d).resolution.reason).toBe("Original attachment is for another property");
  const refreshed=modelIdentity(d);
  d.uw_versions[0].returns_summary.identityResolution={fingerprint:refreshed.fingerprint,outcome:"accepted",actor:"reviewer",at:"2026-11-03",reason:"Subject reassignment independently reconciled against original source"};
  expect(modelIdentity(d).state).toBe("resolved");
 });
 it("does not automatically match a workbook to a deal without a property address",()=>{
  const d:any=deal();delete d.properties.address;
  expect(modelIdentity(d).authoritative).toBe(false);expect(modelIdentity(d).issues.join(" ")).toMatch(/address is missing/);
 });
 it("distinguishes an unresolved discrepancy from confirmed wrong upload and invalidates stale resolution",()=>{
  const d:any=deal(),c=modelIdentity(d);expect(c.state).toBe("unresolved");expect(authoritativeReturns(d)).toBeNull();
  d.uw_versions[0].returns_summary.identityResolution={fingerprint:c.fingerprint,outcome:"accepted",actor:"analyst",at:"2026-10-30",reason:"Template metadata reconciled against original schedules"};
  expect(authoritativeReturns(d)?.irrPct).toBe(.07185);
  d.uw_versions[0].returns_summary.purchasePrice=4000000;
  expect(canExportModel(d,{address:"1301-1347 Lathrop",acres:1.92,buildingSf:9460},"original.xlsx",4000000,.07185)).toBe(true);
  expect(canExportModel(d,{address:"1301-1347 Lathrop",acres:1.92,buildingSf:9460},"original.xlsx",5000000,.07185)).toBe(false);
  d.properties.building_sf=45000;expect(modelIdentity(d).state).toBe("unresolved");
  const n=modelIdentity(d);d.uw_versions[0].returns_summary.identityResolution={...d.uw_versions[0].returns_summary.identityResolution,fingerprint:n.fingerprint,outcome:"wrong_upload"};expect(modelIdentity(d).state).toBe("wrong_upload");expect(authoritativeReturns(d)).toBeNull();
 });
 it("vacant proposed and executed leases are never current income; evidence and effective dates are required",()=>{
  const d:any=deal();d.investment_review={incomeStatus:"proposed",incomeSource:"Broker ready to sign",incomeSourceDate:"2026-10-14",incomeEffectiveDate:"2027-01-01"};
  for(const status of ["proposed","executed","in_place"]){d.investment_review.incomeStatus=status;expect(incomePosition(d,"2026-10-30").current).toBe(false);}
  d.properties.occupancy_status="occupied";expect(incomePosition(d,"2026-10-30").current).toBe(false);expect(incomePosition(d,"2027-01-02").current).toBe(true);
  delete d.investment_review.incomeSource;expect(incomePosition(d,"2027-01-02").current).toBe(false);
  expect(()=>parseInvestmentReview({incomeStatus:"executed"})).toThrow(/source/);
 });
 it("withholds legacy rent rates whose original period is unknown without rewriting cached returns",()=>{
   const d:any={properties:{address:"100 Subject Rd"},uw_versions:[{version_number:1,returns_summary:{sourceProperty:"100 Subject Rd",marketRentPsfMo:16,irrPct:.1}}]};
   expect(authoritativeReturns(d)?.marketRentPsfMo).toBeNull();expect(authoritativeReturns(d)?.irrPct).toBe(.1);expect(d.uw_versions[0].returns_summary.marketRentPsfMo).toBe(16);
 });
 it("retains detected upload conflicts and normalizes annual units without approving source",async()=>{
  const w=new ExcelJS.Workbook(),s=w.addWorksheet("Summary Table"),p=w.addWorksheet("Pro Forma"),m=w.addWorksheet("Market Leasing Summary");
  p.getCell("F15").value="1301-1347 Lathrop";s.getCell("C8").value="1301-1347 Lathrop";s.getCell("C9").value="Houston";s.getCell("C10").value=1.92;s.getCell("C12").value=9460;s.getCell("G18").value=16;m.getCell("D17").value="$/SF/Year";
  const r=await parseReturnsSummary(Buffer.from(await w.xlsx.writeBuffer()),"3000 Amwiler Rd");expect(r.marketRentPsfMo).toBeCloseTo(16/12);expect(r.warnings.join(" ")).toMatch(/discrepancy/);const d:any=deal();d.uw_versions[0].returns_summary=r;expect(modelIdentity(d).authoritative).toBe(false);
 });
});
