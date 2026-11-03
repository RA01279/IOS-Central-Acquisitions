'use client';
import {useState} from 'react';
import type {TaxState,TaxRecord} from '@/lib/property-taxes/types';
import {obligationReviewProblem,recordObligationReview} from '@/lib/property-taxes/obligation-review';

export default function TaxObligationReview({state,row,onChange}:{state:TaxState;row:TaxRecord;onChange:(s:TaxState)=>void}){
 const prior=row.obligationReview;
 const [asOf,setAsOf]=useState(prior?.asOf.slice(0,10)??new Date().toISOString().slice(0,10));
 const [note,setNote]=useState(prior?.note??''),[collectors,setCollectors]=useState(prior?.separateCollectors??''),[revisions,setRevisions]=useState(prior?.revisions??'');
 const [proof,setProof]=useState<string[]>(prior?.sourceIds??[]);
 const [authorities,setAuthorities]=useState((prior?.authorities??row.jurisdictions.filter(j=>j.levied!=null).map(j=>({name:j.name,levied:j.levied!,sourceId:j.sourceId}))).map(a=>({...a,amount:String(a.levied)})));
 const [error,setError]=useState('');
 const originals=state.sources.filter(s=>s.storagePath),issue=obligationReviewProblem(state,row);
 function save(){try{
  const next=recordObligationReview(state,row,{asOf:new Date(asOf+'T00:00:00Z').toISOString(),note,separateCollectors:collectors,revisions,sourceIds:proof,
   authorities:authorities.map(a=>{if(!/^\d+(?:\.\d{1,2})?$/.test(a.amount.trim()))throw Error('Enter an explicit authority amount in dollars and cents.');return {name:a.name,levied:Number(a.amount),sourceId:a.sourceId};})});
  onChange(next);setError('');
 }catch(e){setError(e instanceof Error?e.message:'Check the annual reconciliation.');}}
 return <details><summary>Reconcile annual authority and bill coverage — {issue?'review required':'review recorded'}</summary>
  <p>Reconcile this account’s complete annual levy against retained official originals. Include separately collected authorities and active supplemental bills. Count jointly collected charges once. Resolve temporary bills before completing this review. This is a human review, not an automated completeness certification.</p>
  {prior&&<p>Prior review: {prior.at}; records checked as of {prior.asOf.slice(0,10)}. {issue??'Current evidence agrees with the saved review.'}</p>}
  <label>Official records checked as of<input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></label>
  <label>Authority scope and parcel/account evidence<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
  <label>Separate collectors checked, account links, and how joint collection was counted<textarea value={collectors} onChange={e=>setCollectors(e.target.value)}/></label>
  <label>Revised, supplemental and temporary bills checked; active versions and any superseded originals<textarea value={revisions} onChange={e=>setRevisions(e.target.value)}/></label>
  <fieldset><legend>Retained official originals supporting the review</legend>{originals.map(s=><label key={s.id} style={{display:'block'}}><input type="checkbox" checked={proof.includes(s.id)} onChange={e=>setProof(e.target.checked?[...proof,s.id]:proof.filter(id=>id!==s.id))}/>{s.label}</label>)}{!originals.length&&<p>Attach or retrieve the original records first.</p>}</fieldset>
  <p>Enter one row per distinct authority. Combine its active supplemental charges into that authority’s annual amount, explaining the versions above.</p>
  {authorities.map((a,i)=><div className="tax-form-grid" key={i}>
   <label>Authority name<input value={a.name} onChange={e=>setAuthorities(authorities.map((v,n)=>n===i?{...v,name:e.target.value}:v))}/></label>
   <label>Annual issued levy $<input inputMode="decimal" value={a.amount} onChange={e=>setAuthorities(authorities.map((v,n)=>n===i?{...v,amount:e.target.value}:v))}/></label>
   <label>Supporting original<select value={a.sourceId} onChange={e=>setAuthorities(authorities.map((v,n)=>n===i?{...v,sourceId:e.target.value}:v))}><option value="">Choose retained original</option>{originals.map(s=><option value={s.id} key={s.id}>{s.label}</option>)}</select></label>
   <button type="button" className="secondary" onClick={()=>setAuthorities(authorities.filter((_,n)=>n!==i))}>Remove authority</button>
  </div>)}
  <button type="button" className="secondary" onClick={()=>setAuthorities([...authorities,{name:'',amount:'',levied:0,sourceId:''}])}>Add authority</button>{' '}
  <button type="button" onClick={save}>Record annual reconciliation</button>
  <p>Save the workspace to retain this review. Changed identity, levy or bill evidence requires another review. Missing records remain unresolved.</p>
  {error&&<p role="alert">{error}</p>}
 </details>;
}
