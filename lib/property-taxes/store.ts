import { emptyTaxState, METRICS, type TaxState } from "./types";
import { includedParcels, rateFraction } from "./model";
export class TaxError extends Error { constructor(message: string, public status = 400) { super(message); } }
const array = (v: unknown, max: number): any[] => { if (!Array.isArray(v) || v.length > max) throw new TaxError("Invalid or oversized tax workspace."); return v; };
const string = (v: unknown, max = 500) => { if (typeof v !== "string" || v.length > max) throw new TaxError("Invalid tax text field."); return v; };
const year = (v: unknown) => { if (!Number.isInteger(v) || Number(v) < 1900 || Number(v) > 2200) throw new TaxError("Use an explicit valid tax year."); };
export function validateTaxState(input: unknown): TaxState {
  const s = input as TaxState;
  if (!s || s.version !== 1 || JSON.stringify(s).length > 1_400_000) throw new TaxError("Invalid or oversized tax workspace.");
  const sources = new Set<string>(), parcels = new Set<string>(), records = new Set<string>();
  for (const source of array(s.sources, 600)) {
    string(source.id,100); if (sources.has(source.id)) throw new TaxError("Duplicate source ID."); sources.add(source.id);
    string(source.label); string(source.evidence,60000); string(source.url,4000);
    if (source.url && !/^https?:\/\//i.test(source.url)) throw new TaxError("Use an HTTP(S) source link.");
    if (!Number.isFinite(Date.parse(source.retrievedAt)) || !["official","manual","upload"].includes(source.kind)) throw new TaxError("Source needs a retrieval date and origin.");
    if (source.taxYear !== null) year(source.taxYear);
    if(source.taxYears!==undefined){array(source.taxYears,10).forEach(year);if(new Set(source.taxYears).size!==source.taxYears.length)throw new TaxError('Duplicate source tax year.');}
    if (source.storagePath !== undefined) string(source.storagePath,300);
    if(source.captureMethod!==undefined&&(source.captureMethod!=='user_import'||source.kind!=='manual'))throw new TaxError('Invalid source capture method.');
  }
  const sourceRef = (id: string) => { if (!sources.has(id)) throw new TaxError("Every finding needs a retained supporting source."); };
  if(s.scopeReview){string(s.scopeReview.at,100);string(s.scopeReview.note,4000);if(!Number.isFinite(Date.parse(s.scopeReview.at))||!s.scopeReview.note.trim()||!s.scopeReview.sourceIds.length)throw new TaxError('Parcel-set review needs dated evidence and a scope explanation.');array(s.scopeReview.sourceIds,50).forEach(sourceRef);array(s.scopeReview.parcelKeys,60).forEach(x=>string(x,2000));}
  if(s.scopeReview?.basis!==undefined)string(s.scopeReview.basis,30000);
  for (const p of array(s.parcels,60)) {
    for (const k of ["key","accountId","county","state","address","owner","legal","reviewNote","assessmentGroup"]) string(p[k],2000);
    if (!p.key || !p.accountId || !p.county || !/^[A-Z]{2}$/.test(p.state) || parcels.has(p.key)) throw new TaxError("Each parcel needs a unique key, account, county and state.");
    parcels.add(p.key);
    if (!["pending","included","excluded"].includes(p.review) || !["unknown","combined","land","building"].includes(p.component)) throw new TaxError("Invalid parcel review.");
    array(p.sourceIds,600).forEach(sourceRef); array(p.matchEvidence,30).forEach(x=>string(x,2000));
  }
  for (const r of array(s.records,900)) {
    if (!parcels.has(r.parcelKey)) throw new TaxError("Tax record has no matching parcel."); year(r.year);
    const key = r.parcelKey+":"+r.year; if (records.has(key)) throw new TaxError("Use one annual record per account; merge jurisdiction details."); records.add(key);
    if (!r.facts || typeof r.facts !== "object") throw new TaxError("Invalid annual findings.");
    for (const [metric,f] of Object.entries(r.facts) as [string,any][]) {
      if (!METRICS.includes(metric as any) || !f || !["proposed","adopted","issued","reported"].includes(f.stage) || typeof f.reviewed !== "boolean") throw new TaxError("Invalid tax finding.");
      sourceRef(f.sourceId);
      if (f.value !== null && typeof f.value !== "string" && typeof f.value !== "number") throw new TaxError("Invalid finding value.");
      if (typeof f.value === "number" && (!Number.isFinite(f.value) || f.value < 0)) throw new TaxError("Tax amounts cannot be negative.");
      if (typeof f.value === "string") string(f.value,2000);
    }
    for (const j of array(r.jurisdictions,50)) { string(j.name); rateFraction(j.rate,j.unit); sourceRef(j.sourceId); if (!["proposed","adopted"].includes(j.stage)) throw new TaxError("Rate needs its adoption status.");if(j.levied!==undefined&&j.levied!==null&&(typeof j.levied!=='number'||!Number.isFinite(j.levied)||j.levied<0))throw new TaxError('Invalid authority levy.'); }
    if(r.billEvidence?.obligationStatus!==undefined&&!['partial','temporary','unverified','reconciled'].includes(r.billEvidence.obligationStatus))throw new TaxError('Invalid annual obligation status.');
    if(r.obligationReview){const review=r.obligationReview;
      string(review.at,100);string(review.asOf,100);string(review.note,4000);string(review.separateCollectors,4000);string(review.revisions,4000);string(review.basis,30000);
      if(review.invalidatedBy!==undefined)string(review.invalidatedBy,2000);
      if(!Number.isFinite(Date.parse(review.at))||!Number.isFinite(Date.parse(review.asOf)))throw new TaxError('Annual reconciliation needs actual dates.');
      array(review.sourceIds,50).forEach(sourceRef);
      for(const a of array(review.authorities,50)){string(a.name);sourceRef(a.sourceId);if(typeof a.levied!=='number'||!Number.isFinite(a.levied)||a.levied<0)throw new TaxError('Invalid reconciled authority amount.');}
    }
    if(r.billEvidence){if(!['issued_statement','collector_history'].includes(r.billEvidence.kind))throw new TaxError('Invalid bill evidence type.');sourceRef(r.billEvidence.sourceId);string(r.billEvidence.scope,2000);string(r.billEvidence.notes,4000);if(r.billEvidence.collectorAccount!==undefined)string(r.billEvidence.collectorAccount,100);if(!r.facts.levied||r.facts.levied.sourceId!==r.billEvidence.sourceId)throw new TaxError('Historical bill needs a matching sourced levy.');}
  }
  for (const o of array(s.overrides,1800)) {
    if (!parcels.has(o.parcelKey) || !METRICS.includes(o.metric)) throw new TaxError("Invalid override target."); year(o.year); sourceRef(o.sourceId); string(o.reason,2000);
    if (!o.reason.trim() || !records.has(o.parcelKey+":"+o.year)) throw new TaxError("Overrides need a reason and annual record.");
    if (o.value !== null && typeof o.value !== "number" && typeof o.value !== "string") throw new TaxError("Invalid override value.");
    if (typeof o.value === "number" && (!Number.isFinite(o.value) || o.value < 0)) throw new TaxError("Invalid override amount.");
  }
  const overrideKeys=s.overrides.map(o=>`${o.parcelKey}:${o.year}:${o.metric}`); if (new Set(overrideKeys).size!==overrideKeys.length) throw new TaxError("Duplicate manual override.");
  for (const r of array(s.rules,30)) { string(r.jurisdiction); string(r.notes,12000); array(r.sourceIds,30).forEach(sourceRef); if (typeof r.reviewed!=="boolean") throw new TaxError("Review rule evidence."); }
  const scenarioIds=new Set();
  for (const plan of array(s.scenarios,3)) {
    if (!["continuation","acquisition","custom"].includes(plan.id) || scenarioIds.has(plan.id)) throw new TaxError("Invalid scenario."); scenarioIds.add(plan.id);
    string(plan.name); string(plan.notes,12000); year(plan.startYear);
    if (!Number.isInteger(plan.hold) || plan.hold < 1 || plan.hold > 10 || typeof plan.rulesReviewed!=="boolean") throw new TaxError("Use a 1–10 year hold and explicit rule review.");
    const keys=new Set(); for (const p of array(plan.parcels,60)) {
      if (!parcels.has(p.parcelKey) || keys.has(p.parcelKey)) throw new TaxError("Invalid scenario parcel."); keys.add(p.parcelKey);
      if (array(p.rows,11).length!==plan.hold+1) throw new TaxError("Include the hold plus forward exit year.");
      for (const row of p.rows) {
        year(row.year); rateFraction(row.rate,row.unit);
        for (const key of ["market","ratio","exemption","growth","special","reimbursement"]) if (typeof row[key]!=="number" || !Number.isFinite(row[key])) throw new TaxError("Projection fields must be finite numbers.");
        for (const key of ["cap","capThrough","grossOverride"]) if (row[key]!==null && (typeof row[key]!=="number" || !Number.isFinite(row[key]))) throw new TaxError("Invalid optional projection field.");
        if (typeof row.reassess!=="boolean") throw new TaxError("Review reassessment timing.");
      }
    }
  }
  if (s.research) {
    string(s.research.at,100); if(!Number.isFinite(Date.parse(s.research.at))||!['partial','complete'].includes(s.research.status))throw new TaxError('Invalid research result.');
    array(s.research.gaps,100).forEach(x=>string(x,4000));
    for(const d of array(s.research.discovery??[],60)){
      string(d.jurisdiction,200);string(d.at,100);if(!Number.isFinite(Date.parse(d.at))||!['adapter_available','onboarding_required','directory_unavailable'].includes(d.status))throw new TaxError('Invalid source investigation.');
      if(d.adapter!==undefined)string(d.adapter,100);array(d.sourceIds,30).forEach(sourceRef);array(d.nextSteps,20).forEach(x=>string(x,4000));
      for(const l of array(d.officialLinks,100)){string(l.label,500);string(l.url,4000);if(!/^https?:\/\//.test(l.url))throw new TaxError('Discovery requires HTTP(S) official links.');}
      for(const check of array(d.interfaceChecks??[],10)){string(check.url,4000);string(check.at,100);string(check.message,4000);if(!/^https?:\/\//.test(check.url)||!['public_page','interactive_verification','http_error','transport_failure'].includes(check.access))throw new TaxError('Invalid public interface check.');if(check.portalFamily!==null)string(check.portalFamily,100);for(const l of array(check.publishedInterfaces,40)){string(l.label,500);string(l.url,4000);if(!/^https?:\/\//.test(l.url))throw new TaxError('Invalid public interface URL.');}}
    }
    for(const a of array(s.research.attempts??[],60)){
      if(!parcels.has(a.parcelKey)||!['retrieved','partial','blocked','unsupported','failed'].includes(a.status))throw new TaxError('Invalid account research result.');
      string(a.message,4000);if(a.sourceUrl!==undefined){string(a.sourceUrl,4000);if(!/^https:\/\//.test(a.sourceUrl))throw new TaxError('Invalid official research link.');}
    }
  }
  // Invalid overlapping inclusion must never reach totals or underwriting.
  try { includedParcels(s); } catch(e) { throw new TaxError((e as Error).message); }
  return s;
}
export async function loadTaxWorkspace(db:any,dealId:string) {
  if(dealId.startsWith('asset:')){const {data,error}=await db.from('property_tax_subjects').select('revision,state,updated_at').eq('subject_kind','asset').eq('subject_id',dealId.slice(6)).maybeSingle();if(error)throw new TaxError('Asset tax storage unavailable.',503);return data?{...data,updated_by:'tax-ingestion'}:{revision:0,state:emptyTaxState(),updated_at:null,updated_by:null};}
  const { data,error }=await db.from("deal_property_taxes").select("revision,state,updated_at,updated_by").eq("deal_id",dealId).maybeSingle();
  if(error) throw new TaxError("Property tax storage is unavailable. Apply the pending local tax migration before use.",503);
  return data ?? {revision:0,state:emptyTaxState(),updated_at:null,updated_by:null};
}
export async function saveTaxWorkspace(db:any,dealId:string,revision:number,state:TaxState,actor:string,action:'review'|'research'|'upload'="review") {
  validateTaxState(state);
  if (!Number.isInteger(revision) || revision<0) throw new TaxError("Invalid workspace revision.");
  if(dealId.startsWith('asset:')){const {data,error}=await db.rpc('save_property_tax_subject',{p_kind:'asset',p_id:dealId.slice(6),p_expected:revision,p_state:state});if(error)throw new TaxError(error.message,error.code==='40001'?409:500);return {revision:data,state,updated_at:new Date().toISOString(),updated_by:actor};}
  const { data,error }=await db.rpc("save_deal_tax_state",{p_deal_id:dealId,p_expected:revision,p_state:state,p_actor:actor,p_action:action});
  if(error) throw new TaxError(error.code==="40001" ? "Tax workspace changed. Reload before saving; keep a copy of your local draft." : error.message, error.code==="40001" ? 409 : 500);
  return data;
}
