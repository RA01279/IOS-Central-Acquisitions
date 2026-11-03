import {it,expect} from "vitest";
import {decisionReport} from "./decision-report";
const deal=()=>({id:"kennedale",stage:"offered",properties:{address:"7321 Kennedale Pkwy",occupancy_status:"vacant"},asking_price:8500000,assigned_analyst:"Analyst",offers:[{price:7500000,offered_at:"2026-10-16"}],investment_review:{incomeStatus:"proposed",incomeSource:"Broker ready to sign",incomeSourceDate:"2026-10-14",incomeEffectiveDate:"2027-01-01",selectedModelId:"v2",nextAction:"Reconcile lease execution and expense recoveries"},uw_versions:[{id:"v2",version_number:2,created_at:"2026-10-16",returns_summary:{purchasePrice:7500000,irrPct:.2292509973,sourceProperty:"7321 Kennedale Pkwy"},model_detail:{uw:{year1Noi:637776}}},{id:"v3",version_number:3,created_at:"2026-10-20",returns_summary:{purchasePrice:9999999,irrPct:.99,sourceProperty:"Another property"}}],uw_runs:[{created_at:"2026-10-29",uw_version_id:"v2",results:{returns:{leveredIrr:.10487421895,year1Noi:457633.8}}}]});
it("reports selected sources and an established NOI difference without forcing distinct IRRs to match",()=>{
 const d=decisionReport(deal());expect(d.modelVersion).toBe(2);expect(d.modelPrice).toBe(7500000);expect(d.modelIrr).toBe(.2292509973);expect(d.screeningIrr).toBe(.10487421895);expect(d.bridge).toMatch(/-180142.20/);expect(d.bridge).toMatch(/Full IRR reconciliation not established/);expect(d.currentBaseRent).toBe(0);expect(d.askingDate).toBeNull();expect(d.vehicle).toBeNull();
});
it("withholds unresolved model returns and marks stale screening/version and comp relationships",()=>{
 const d:any=deal();d.investment_review.selectedModelId="v3";d.deal_analysis_versions=[{kind:"comps",version:2,created_at:"2026-10-30",payload:{excluded:["Casey"]}}];
 const r=decisionReport(d);expect(r.modelIrr).toBeNull();expect(r.identityState).toBe("unresolved");expect(r.conflicts).toMatch(/another or unlinked workbook/);expect(r.conflicts).toMatch(/predates/);expect(r.compReview).toMatch(/1 excluded/);
});
