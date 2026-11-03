import {latestVersion,modelIdentity,incomePosition} from "./investment-review";
import {annualInPlaceRent} from "./asset-performance";
const number=(v:unknown)=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
/** Exact source figures only. A difference is not a claim of equivalent models. */
export function decisionReport(deal:any) {
 const p=Array.isArray(deal.properties)?deal.properties[0]:deal.properties;
 const r=deal.investment_review??{},v=latestVersion(deal),identity=modelIdentity(deal,v),income=incomePosition(deal);
 const bid=[...(deal.offers??[])].sort((a:any,b:any)=>String(b.offered_at).localeCompare(String(a.offered_at)))[0];
 const screen=[...(deal.uw_runs??[])].sort((a:any,b:any)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
 const comps=[...(deal.deal_analysis_versions??[])].filter((a:any)=>a.kind==="comps").sort((a:any,b:any)=>b.version-a.version)[0];
 const workbookNoi=number(v?.model_detail?.uw?.year1Noi),screenNoi=number(screen?.results?.returns?.year1Noi);
 const screenCurrent=!!screen&&screen.uw_version_id===v?.id;
 const messages=identity.resolution?[`Identity resolution (${identity.state}) by ${identity.resolution.actor}: ${identity.resolution.reason}`]:[...identity.issues];
 if(v?.returns_summary?.marketRentPsfMo!=null&&!v.returns_summary.marketRentSourceBasis)messages.push("Historical market rent units unverified; rate withheld pending original-source reconciliation");
 if(!identity.authoritative&&v)messages.push("Workbook returns withheld pending source resolution");
 if(!income.current)messages.push(income.label);
 if(screen&&!screenCurrent)messages.push("Saved screening run is based on another or unlinked workbook version; comparison is historical");
 if(screen&&comps&&screen.created_at<comps.created_at)messages.push("Saved screen predates the reviewed comp selection; rerun before relying on comp-driven inputs");
 if(!r.nextAction)messages.push("Next action unknown");
 if(!deal.assigned_analyst)messages.push("Owner unassigned");
 const nnn=screen?.inputs?.NnnRecovered;
 if(nnn===true)messages.push(`Screen assumes full expense recovery from month ${screen.inputs.RecoveryStartMonth??0}; verify executed lease support and carrying costs before commencement`);
 const bridge=workbookNoi!==null&&screenNoi!==null?`Year-one NOI: screening ${screenNoi.toFixed(2)} minus workbook ${workbookNoi.toFixed(2)} = ${(screenNoi-workbookNoi).toFixed(2)}. ${screenCurrent?"Same source version; assumptions can differ.":"Different/unlinked source versions; not an equivalent-case reconciliation."} Full IRR reconciliation not established.`:"Year-one NOI bridge unknown: both source figures required";
 const inputs=screen?.inputs,model=v?.model_detail?.uw;
 const assumptions:string[]=[];
 if(inputs&&model){
  const pct=(x:number)=>`${(x*100).toFixed(2)}%`;
  const compare=(label:string,a:unknown,b:unknown,format=(x:number)=>String(x))=>{const x=number(a),y=number(b);if(x!==null&&y!==null&&Math.abs(x-y)>1e-7)assumptions.push(`${label}: screening ${format(x)}; workbook ${format(y)}`);};
  const scenario=["Base","Upside","Downside"].indexOf(inputs.scenario);
  compare("Price",inputs.PurchPrice,model.purchasePrice);compare("Hold years",inputs.Hold,model.holdYears);compare("Exit cap",inputs.levers?.ExitCap?.[scenario],model.exitCap,pct);compare("Debt LTV",inputs.LoanLTV,model.debt?.ltpp,pct);compare("Loan rate",inputs.LoanRate,model.debt?.rate,pct);compare("Interest-only years",inputs.IOYrs,model.debt?.ioMonths==null?null:model.debt.ioMonths/12);
  assumptions.push(`Screen expense recovery: ${inputs.NnnRecovered===true?"assumed recovered":"owner carries expenses"}; tax ${inputs.TaxSwitch===1?"reassessed at modeled price":"seller amount"}, insurance ${inputs.Insurance??"unknown"}, other operating expense ${inputs.OtherOpex??"unknown"}. Workbook expense-line reconciliation not recorded.`);
 } else assumptions.push("Detailed screening/workbook assumption comparison unavailable; source snapshots required");
 return {id:deal.id,address:p?.address??"Unknown",owner:deal.assigned_analyst??null,rationale:r.rationale??null,status:r.decisionStatus??deal.stage??null,vehicle:r.vehicle??null,nextAction:r.nextAction??null,followUpOn:deal.follow_up_on??null,deadline:deal.call_for_offers_on??null,deadlineSource:r.deadlineSource??null,deadlineSourceDate:r.deadlineSourceDate??null,downside:r.downside??null,
  askingPrice:number(deal.asking_price),askingDate:r.askingDate??null,askingSource:r.askingSource??null,modelId:v?.id??null,modelVersion:v?.version_number??null,modelDate:v?.created_at??null,modelPrice:number(v?.returns_summary?.purchasePrice),modelIrr:identity.authoritative?number(v?.returns_summary?.irrPct):null,returnSource:v?`Cached workbook v${v.version_number} · ${v.created_at} · ${r.selectedModelId?"explicitly selected":"latest automatically; not approved"}`:"Unknown",identityState:identity.state,
  latestBid:number(bid?.price),bidDate:bid?.offered_at??null,income:income.label,incomeSource:income.source,incomeEffectiveDate:income.effectiveDate,currentBaseRent:p?.occupancy_status==="vacant"?0:income.current?annualInPlaceRent(deal.in_place_rent,deal.in_place_rent_basis,p?.lot_sf,p?.building_sf):null,
  screeningIrr:number(screen?.results?.returns?.leveredIrr),screenDate:screen?.created_at??null,screenModelId:screen?.uw_version_id??null,bridge,assumptions:assumptions.join("; "),conflicts:messages.join("; "),compReview:comps?`v${comps.version} · ${comps.created_at} · ${(comps.payload?.excluded??[]).length} excluded; frozen evidence`:"Unreviewed live evidence",reviewedAt:r.updatedAt??null};
}
