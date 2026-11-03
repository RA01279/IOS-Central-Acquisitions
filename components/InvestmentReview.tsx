"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { incomePosition, latestVersion, modelIdentity } from "@/lib/investment-review";
import DealImport from "./DealImport";
export default function InvestmentReview({deal}:{deal:any}) {
  const router=useRouter(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [deadlineDraft,setDeadlineDraft]=useState<any>(null);
  const v=latestVersion(deal), identity=modelIdentity(deal), income=incomePosition(deal),r=deal.investment_review??{};
  async function send(body:any){setBusy(true);setError("");try{const response=await fetch(`/api/deals/${deal.id}/investment-review`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,expectedReviewAt:r.updatedAt??null,expectedResolutionAt:v?.returns_summary?.identityResolution?.at??null})});const result=await response.json();if(!response.ok)throw new Error(result.error);router.refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  // Collapsed by default: the full form is long and only needed when reviewing the source.
  return <details id="investment-review" className="panel fin-collapse"><summary><h2>Investment evidence and decision</h2><span className="fin-collapse-meta">Identity: {identity.state} · {income.label}</span></summary>
    <p>{income.label}. Income source: {income.source??"Unknown"}; effective: {income.effectiveDate??"Unknown"}.</p>
    <p>Reported source: {v?`workbook v${v.version_number} · ${v.created_at} · cached workbook returns · ${r.selectedModelId?"explicitly selected":"latest automatically; not approved"}`:"No workbook"}. Identity: {identity.state}.</p>
    {!!identity.issues.length&&<ul className="warning">{identity.issues.map(x=><li key={x}>{x}</li>)}</ul>}
    {identity.resolution&&<p>Reviewed by {identity.resolution.actor}: {identity.resolution.reason}</p>}
    {v&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);send({action:"resolve_model",versionId:v.id,outcome:f.get("outcome"),reason:f.get("reason")});}}><label>Identity resolution <select name="outcome"><option value="accepted">Accept source after reconciliation</option><option value="wrong_upload">Confirmed wrong upload; exclude</option></select></label><label>Evidence and explanation <textarea required minLength={10} maxLength={2000} name="reason"/></label><button disabled={busy}>Record resolution</button></form>}
    <details><summary>Extract a deadline from a source update for this existing deal</summary><DealImport onImported={(draft)=>{const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");if(norm(draft.fields.address??"")!==norm(deal.properties?.address??"")){setError("Source address differs from this deal. Review the source and update manually; nothing applied.");return;}setDeadlineDraft(draft.fields);}}/>{deadlineDraft&&<p>Draft extracted. Review the explicit date and source fields below before saving. No new deal is created.</p>}</details>
    <form key={JSON.stringify(deadlineDraft)} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),review=Object.fromEntries(f);delete review.followUpOn;delete review.callForOffersOn;send({review,followUpOn:f.get("followUpOn"),callForOffersOn:f.get("callForOffersOn")});}}>
      <label>Income status <select name="incomeStatus" defaultValue={r.incomeStatus??"unknown"}><option value="unknown">Unknown / unverified</option><option value="proposed">Proposed lease income</option><option value="executed">Executed; not yet in place</option><option value="in_place">In-place income</option></select></label>
      <label>Model used for reported returns<select name="selectedModelId" defaultValue={r.selectedModelId??""}><option value="">Latest version (automatic; not approved)</option>{[...(deal.uw_versions??[])].sort((a:any,b:any)=>b.version_number-a.version_number).map((m:any)=><option value={m.id} key={m.id}>v{m.version_number} · {m.created_at}</option>)}</select></label>
      {[["incomeSource","Income source / executed lease reference"],["incomeSourceDate","Income source date"],["incomeEffectiveDate","Income commencement / effective date"],["rationale","Pursuit rationale"],["decisionStatus","Current decision status"],["vehicle","Vehicle / partner fit"],["downside","Supported downside drivers"],["askingSource","Asking guidance source"],["askingDate","Asking guidance date"],["nextAction","Requested next action"],["deadlineSource","Offer deadline source quote / reference"],["deadlineSourceDate","Deadline source date"]].map(([key,label])=><label key={key}>{label}<input name={key} type={key.endsWith("Date")?"date":"text"} defaultValue={(key==="deadlineSource"?deadlineDraft?.deadlineSourceQuote:key==="deadlineSourceDate"?deadlineDraft?.deadlineSourceDate:null)??r[key]??""} maxLength={2000}/></label>)}
      <p>Owner: {deal.assigned_analyst??"Unassigned"}. Proposed income belongs in an explicit screening case; it is not current rent. Vacant sites remain vacant in current-income reporting.</p>
      <label>Next follow-up date (blank = unassigned)<input name="followUpOn" type="date" defaultValue={deal.follow_up_on??""}/></label>
      <label>Explicit call for offers date<input name="callForOffersOn" type="date" defaultValue={deadlineDraft?.callForOffersOn??deal.call_for_offers_on??""}/></label>
      <button disabled={busy}>Save evidence and decision</button>
    </form>{error&&<p role="alert" className="error">{error}</p>}
  </details>;
}
