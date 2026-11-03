import { describe,it,expect } from "vitest";
import { annualTotal,effectiveFact,includedParcels,makeScenario,matchParcel,mergeResearch,parcelKey,projectRow,projectScenario,rateFraction,toTaxSchedule } from "../model";
import { validateTaxState } from "../store";
import { projectionRow,taxFixture,parcel,source,reviewFixture } from "./fixtures";
describe("property tax identity and historical evidence",()=>{
  it("matches street abbreviations without treating a pin as acquisition boundary proof",()=>{
    expect(matchParcel({address:"100 N. Main Rd."},parcel,true)).toMatchObject({ambiguous:false});
    expect(matchParcel({address:"101 Main Road"},parcel,true).ambiguous).toBe(true);
    expect(matchParcel({address:parcel.address,county:"Different",state:"GA"},parcel,true).ambiguous).toBe(true);
    expect(parcelKey("TX","Test County","123-456")).toBe(parcelKey("tx","Test","123 456"));
  });
  it("sums only complete reviewed years across multiple parcels and leaves unknown years missing",()=>{
    const s=taxFixture();s.parcels.push({...parcel,key:"second",accountId:"2",assessmentGroup:"lot-2"});
    s.scopeReview!.parcelKeys.push('second');
    reviewFixture(s);expect(annualTotal(s,2026,"levied")).toMatchObject({total:null,knownSubtotal:2000,missing:["2"]});
    s.records.push({parcelKey:"second",year:2026,facts:{levied:{value:500,sourceId:source.id,stage:"issued",reviewed:true}},jurisdictions:[]});
    s.records[1].billEvidence={...s.records[0].billEvidence!,collectorAccount:'2'};
    reviewFixture(s,1);
    expect(annualTotal(s,2026,"levied").total).toBe(2500);
    expect(annualTotal(s,2025,"levied").total).toBeNull();
    expect(annualTotal(s,2026,"paid").total).toBeNull();
    s.records[1].facts.levied!.stage="proposed";expect(annualTotal(s,2026,"levied").total).toBeNull();
    s.parcels[1].review="pending";expect(annualTotal(s,2026,"levied").total).toBeNull();
  });
  it("prevents combined/component and duplicate accounts being counted twice",()=>{
    const s=taxFixture();s.parcels.push({...parcel,key:"building",accountId:"2",component:"building"});
    expect(()=>includedParcels(s)).toThrow(/Overlapping/);
    s.parcels[0].component="land";expect(includedParcels(s)).toHaveLength(2);
    s.parcels[1].accountId="1";expect(()=>includedParcels(s)).toThrow(/Duplicate account/);
  });
  it("preserves manual overrides and original evidence, invalidates changed imports and scenarios",()=>{
    const s=taxFixture(),incoming=taxFixture();s.overrides=[{parcelKey:parcel.key,year:2026,metric:"levied",value:1800,sourceId:source.id,reason:"Corrected bill"}];
    incoming.sources=[{...source,id:"new",evidence:"Changed issued bill"}];incoming.records[0].facts.levied={value:2200,sourceId:"new",stage:"issued",reviewed:false};
    s.scenarios=[{...makeScenario(s,"custom",2027,2),notes:"Test",rulesReviewed:true}];
    const merged=mergeResearch(s,incoming);
    expect(merged.overrides).toEqual(s.overrides);expect(effectiveFact(merged,merged.records[0],"levied")?.value).toBe(1800);
    expect(merged.records[0].facts.levied).toMatchObject({value:2200,previous:2000,reviewed:false});
    expect(merged.sources).toHaveLength(2);expect(merged.scenarios[0].rulesReviewed).toBe(false);
    incoming.parcels[0].address="999 Other St";expect(mergeResearch(s,incoming).parcels[0].review).toBe("pending");
  });
});
describe("jurisdiction units and projection timing",()=>{
  it("retains corrected account identity and manual rate entries when research refreshes",()=>{
    const s=taxFixture(),incoming=taxFixture();s.parcels[0].identityOverride=true;s.parcels[0].accountId="corrected";
    s.records[0].jurisdictions=[{name:"Manual school district",rate:15,unit:"mills",taxable:40000,exemption:2000,sourceId:source.id,stage:"adopted"}];
    incoming.records[0].facts.levied!.value=9999;incoming.research={at:source.retrievedAt,status:"partial",gaps:[]};
    const merged=mergeResearch(s,incoming);expect(merged.parcels[0].accountId).toBe("corrected");expect(merged.records[0].facts.levied!.value).toBe(2000);expect(merged.records[0].jurisdictions[0].name).toContain("Manual");expect(merged.research?.gaps[0]).toContain("correction retained");
  });
  it("combines independent parcel schedules without applying the property value twice",()=>{
    const s=taxFixture();s.parcels.push({...parcel,key:"second",accountId:"2",assessmentGroup:"lot-2"});
    const plan=makeScenario(s,"custom",2027,1);plan.notes="Allocated parcel values";plan.rulesReviewed=true;plan.parcels[0].rows=[projectionRow(),projectionRow({year:2028})];plan.parcels[1].rows=[projectionRow({market:50000}),projectionRow({year:2028,market:50000})];expect(projectScenario(s,plan).map(r=>r.gross)).toEqual([3000,3000]);
  });
  it.each([[2,"per_100"],[20,"mills"],[2,"percent"],[0.02,"decimal"]] as const)("converts %s %s explicitly",(rate,unit)=>expect(rateFraction(rate,unit)).toBe(.02));
  it("matches the official Georgia DOR worked example, without assuming its homestead exemption applies to IOS",()=>{
    // https://dor.georgia.gov/property-tax-real-and-personal-property-faq
    // Retrieved 2026-10-21: $100,000 FMV x 40%, less $2,000, x 25 mills = $950.
    const actual=projectRow(projectionRow({market:100000,ratio:.4,exemption:2000,rate:25,unit:"mills"}),null);
    expect(actual).toMatchObject({assessed:40000,taxable:38000,gross:950});
    expect(projectRow(projectionRow({market:100000,ratio:.4,exemption:0,rate:25,unit:"mills"}),null).gross).toBe(1000);
  });
  it("applies a cap only within its supported years and explicit reset timing",()=>{
    const row=projectionRow({year:2026,market:200000,cap:.2,capThrough:2026});
    expect(projectRow(row,100000).assessed).toBe(120000);
    expect(projectRow({...row,year:2027},120000).assessed).toBe(200000);
    expect(projectRow({...row,reassess:true},100000).assessed).toBe(200000);
  });
  it("keeps acquisition sensitivity independent of purchase price and supports annual exemptions, rates and special charges",()=>{
    const s=taxFixture(),plan=makeScenario(s,"acquisition",2027,2);plan.notes="No purchase reset; valuation change effective 2028";plan.rulesReviewed=true;
    plan.parcels[0].rows=[projectionRow(),projectionRow({year:2028,market:200000,reassess:true,exemption:10000,special:200,reimbursement:500}),projectionRow({year:2029,market:200000,rate:3,grossOverride:7000})];
    expect(projectScenario(s,plan).map(r=>r.gross)).toEqual([2000,4000,7000]);
    expect(projectScenario(s,plan)[1].net).toBe(3500);
    const schedule=toTaxSchedule(s,plan,"2026-10-21T00:00:00Z");expect(schedule.gross).toHaveLength(3);expect(schedule.provenance).toContain("No purchase reset");
    plan.rulesReviewed=false;expect(()=>projectScenario(s,plan)).toThrow(/Review/);
  });
  it("requires local rule evidence, nonoverlapping reviewed parcels and a forward year",()=>{
    const s=taxFixture(),plan=makeScenario(s,"continuation",2027,1);plan.notes="Reviewed synthetic rules";plan.rulesReviewed=true;
    s.rules=[];expect(()=>projectScenario(s,plan)).toThrow(/jurisdiction rules/);
    s.rules=taxFixture().rules;s.parcels[0].review="pending";expect(()=>projectScenario(s,plan)).toThrow(/parcel/);
    s.parcels[0].review="included";s.rules[0].jurisdiction="Other, GA";expect(()=>projectScenario(s,plan)).toThrow(/Test, TX/);s.rules=taxFixture().rules;plan.parcels[0].rows.pop();expect(()=>projectScenario(s,plan)).toThrow(/forward/);
    expect(()=>projectRow(projectionRow({reimbursement:3000}),null)).toThrow(/reimbursements/);
    expect(()=>rateFraction(NaN,"mills")).toThrow();
  });
  it("validates source links and prevents unsupported or malformed data entering storage",()=>{
    const s=taxFixture();expect(validateTaxState(s)).toBe(s);
    s.sources[0].url="javascript:alert(1)";expect(()=>validateTaxState(s)).toThrow(/HTTP/);
    s.sources[0].url=source.url;s.records[0].facts.levied!.sourceId="missing";expect(()=>validateTaxState(s)).toThrow(/supporting source/);
  });
});
