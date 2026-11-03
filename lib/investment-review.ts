/** Shared decision semantics for screens, screening and exports. No I/O. */
export type IncomeStatus = "unknown" | "proposed" | "executed" | "in_place";
export interface InvestmentReview {
  incomeStatus: IncomeStatus;
  incomeSource: string | null;
  incomeSourceDate: string | null;
  incomeEffectiveDate: string | null;
  rationale: string | null;
  decisionStatus: string | null;
  nextAction: string | null;
  vehicle: string | null;
  downside: string | null;
  askingSource: string | null;
  askingDate: string | null;
  deadlineSource: string | null;
  deadlineSourceDate: string | null;
  selectedModelId?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}
export function latestVersion(deal: any): any | null {
  if(deal.investment_review?.selectedModelId)return (deal.uw_versions??[]).find((v:any)=>v.id===deal.investment_review.selectedModelId)??null;
  return [...(deal.uw_versions ?? [])].sort((a: any,b: any)=>b.version_number-a.version_number)[0] ?? null;
}
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function modelIdentity(deal: any, version = latestVersion(deal)) {
  const p = Array.isArray(deal.properties) ? deal.properties[0] : deal.properties;
  const summary = version?.returns_summary;
  const source = summary?.sourceIdentity ?? { address: summary?.sourceProperty ?? version?.model_detail?.sourceProperty };
  const issues: string[] = [];
  if (!version) return { state: "missing", issues: ["No workbook version"], authoritative: false, source };
  if (!p?.address) issues.push("Deal property address is missing; workbook identity cannot be verified");
  if (!source.address) issues.push("Internal workbook property identity has not been verified");
  else if (p?.address && norm(source.address) !== norm(p.address)) issues.push(`Workbook identifies ${source.address}; deal identifies ${p.address}. This is a discrepancy, not a confirmed wrong upload.`);
  for (const [key, expected] of [["buildingSf", Number(p?.building_sf)], ["acres", Number(p?.lot_sf)/43560]] as const) {
    const actual = Number(source[key]);
    if (actual > 0 && expected > 0 && Math.abs(actual/expected-1) > .1) issues.push(`Workbook ${key}: ${actual}; deal: ${expected}`);
  }
  if (source.city && p?.city && norm(source.city)!==norm(p.city)) issues.push(`Workbook city ${source.city}; deal city ${p.city}`);
  const resolution = summary?.identityResolution;
  // Resolution is tied to the reviewed subject and exact source facts. Edits invalidate it.
  const fingerprint = JSON.stringify({ address:p?.address,city:p?.city,buildingSf:p?.building_sf,lotSf:p?.lot_sf,source });
  const recorded = !!(resolution?.actor && resolution?.at && resolution?.reason);
  const resolved = recorded && resolution?.fingerprint===fingerprint && ["accepted","wrong_upload"].includes(resolution.outcome);
  // Rejection belongs to the uploaded file. Editing the subject must never
  // silently rehabilitate a source already confirmed to be the wrong upload.
  const rejected = recorded && resolution.outcome==="wrong_upload";
  if (rejected) issues.push("This file was explicitly confirmed as a wrong upload; a new recorded resolution is required before reuse");
  return { state: rejected ? "wrong_upload" : resolved ? "resolved" : issues.length ? "unresolved" : "matched", issues, source, fingerprint, resolution: resolved || rejected ? resolution : null, authoritative: !rejected && (resolved || issues.length===0) };
}
export function authoritativeReturns(deal: any) {
  const v=latestVersion(deal);
  if(!modelIdentity(deal,v).authoritative)return null;
  const r=v?.returns_summary??null;
  if(r?.marketRentPsfMo!=null&&!r.marketRentSourceBasis)return {...r,marketRentPsfMo:null,warnings:[...(r.warnings??[]),"Historical market-rent units unverified; reconcile the original basis before using this rate"]};
  return r;
}

/** A resolved template discrepancy can travel only with the same recorded source. */
export function canExportModel(deal:any,incoming:{address:string|null;acres:number|null;buildingSf:number|null},fileName:string,price:number|null,irr:number|null):boolean {
  const selected=latestVersion(deal),review=modelIdentity(deal,selected);
  if(review.state==="wrong_upload")return false;
  if(modelIdentity(deal,{returns_summary:{sourceIdentity:incoming}}).authoritative)return true;
  if(review.state!=="resolved"||!incoming.address||norm(incoming.address)!==norm(review.source.address))return false;
  for(const key of ["acres","buildingSf"] as const)if(review.source[key]!=null&&Number(review.source[key])!==incoming[key])return false;
  const savedName=selected?.model_detail?.uw?.fileName;
  if(savedName&&savedName!==fileName)return false;
  const savedPrice=selected?.returns_summary?.purchasePrice,savedIrr=selected?.returns_summary?.irrPct;
  return savedPrice!=null&&price!=null&&Math.abs(savedPrice-price)<.01&&savedIrr!=null&&irr!=null&&Math.abs(savedIrr-irr)<1e-6;
}
export function incomePosition(deal: any, today=new Date().toISOString().slice(0,10)) {
  const p=Array.isArray(deal.properties)?deal.properties[0]:deal.properties;
  const r=deal.investment_review;
  const status:IncomeStatus=r?.incomeStatus ?? "unknown";
  const supported=!!(r?.incomeSource && r?.incomeSourceDate && r?.incomeEffectiveDate);
  const current=status==="in_place" && supported && r.incomeEffectiveDate<=today && p?.occupancy_status!=="vacant";
  const vacancyLabel=status==="proposed"?"Currently vacant; proposed lease income, no current in-place income":status==="executed"?"Currently vacant; executed lease, commencement to verify":status==="in_place"?"Vacancy conflicts with recorded in-place status; current income withheld":"Currently vacant; no current in-place income";
  return {status,current,label:current?"In-place income":p?.occupancy_status==="vacant"?vacancyLabel:status==="proposed"?"Proposed income":status==="executed"?"Executed lease; commencement to verify":"Current income unverified",source:r?.incomeSource ?? null,effectiveDate:r?.incomeEffectiveDate ?? null};
}
export function parseInvestmentReview(value: any): InvestmentReview {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Provide a review object");
  const result:any={};
  if (!["unknown","proposed","executed","in_place"].includes(value.incomeStatus)) throw new Error("Choose an income status");
  result.incomeStatus=value.incomeStatus;
  for(const key of ["incomeSource","incomeSourceDate","incomeEffectiveDate","rationale","decisionStatus","nextAction","vehicle","downside","askingSource","askingDate","deadlineSource","deadlineSourceDate","selectedModelId"]) {
    if(value[key]!=null && typeof value[key]!=="string") throw new Error(`Invalid ${key}`);
    const text=value[key]?.trim() || null;
    if(text && text.length>2000) throw new Error(`${key} is too long`);
    if(text && /Date$/.test(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(text)||new Date(text+"T12:00:00Z").toISOString().slice(0,10)!==text)) throw new Error(`Invalid ${key}`);
    result[key]=text;
  }
  if(result.incomeStatus!=="unknown" && (!result.incomeSource || !result.incomeSourceDate)) throw new Error("Record income source and source date; otherwise leave status unknown");
  if(result.incomeStatus==="in_place"&&!result.incomeEffectiveDate)throw new Error("In-place income requires a supported commencement / effective date");
  return result;
}
