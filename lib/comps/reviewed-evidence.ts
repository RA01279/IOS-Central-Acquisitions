import type {CompRecord,Subject} from "./match";
/** A saved review is frozen evidence. No automatic merge with newer rows. */
export function compReview(deal:any,live:CompRecord[],subject:Subject) {
 const saved=[...(deal.deal_analysis_versions??[])].filter((r:any)=>r.kind==="comps").sort((a:any,b:any)=>b.version-a.version)[0];
 if(!saved)return {comps:live,subject,label:"Unreviewed current comp evidence",saved:null,stale:false};
 const p=saved.payload;
 // Postgres jsonb can reorder keys; compare subject facts, not serialization order.
 const fields:[keyof Subject,...(keyof Subject)[]]=["lat","lng","lotSf","buildingSf","coveragePct","assetClass","market","submarket"];
 const stale=fields.some(key=>(p.subject?.[key]??null)!==(subject[key]??null));
 const excluded=new Set(p.excluded??[]);
 return {comps:stale?[]:(p.comps??[]).filter((c:CompRecord)=>!excluded.has(c.id)),subject,label:`Reviewed comps v${saved.version} · ${saved.created_at}${stale?" · Subject changed; review again":" · Frozen evidence; changes require a new review"}`,saved,stale};
}
