import { emptyTaxState, type TaxState, type TaxParcel, type TaxSource, type ProjectionYear } from "../types";
import {recordObligationReview} from '../obligation-review';
import {parcelScopeBasis} from '../parcel-scope';
export function reviewFixture(s:TaxState,index=0){
 const row=s.records[index],f=s.overrides.find(o=>o.parcelKey===row.parcelKey&&o.year===row.year&&o.metric==='levied')??row.facts.levied!;
 const original=s.sources.find(source=>source.id===f.sourceId)!;
 original.kind='official';
 original.storagePath??='deals/00000000-0000-4000-8000-000000000001/property-taxes/synthetic.pdf';
 const next=recordObligationReview(s,row,{asOf:'2026-10-21T00:00:00Z',note:'Synthetic test authority scope',separateCollectors:'Synthetic sole collector confirmed',revisions:'Synthetic final record; no additional versions',sourceIds:[original.id],authorities:[{name:'Synthetic authority',levied:Number(f.value),sourceId:original.id}]});
 s.records=next.records;if(s.scopeReview)s.scopeReview={...s.scopeReview,basis:parcelScopeBasis(s)};return s;
}
export const source:TaxSource={id:"source-1",label:"Synthetic county record",url:"https://example.gov/record",retrievedAt:"2026-10-21T00:00:00Z",taxYear:2026,kind:"manual",evidence:"Synthetic record, never production."};
export const parcel:TaxParcel={key:"TX:test:1",accountId:"1",county:"Test",state:"TX",address:"100 North Main Road",owner:"Synthetic owner",legal:"Synthetic lot",sourceIds:[source.id],matchEvidence:["Synthetic boundary and situs evidence"],review:"included",reviewNote:"Verified synthetic subject boundaries",component:"combined",assessmentGroup:"lot-1"};
export const projectionRow=(patch:Partial<ProjectionYear>={}):ProjectionYear=>({year:2027,market:100000,ratio:1,exemption:0,growth:0,cap:null,capThrough:null,rate:2,unit:"per_100",special:0,reimbursement:0,grossOverride:null,reassess:false,...patch});
export function taxFixture():TaxState {const s=emptyTaxState();s.sources=[structuredClone(source)];s.parcels=[structuredClone(parcel)];s.scopeReview={at:'2026-10-21T00:00:00Z',note:'Verified synthetic acquisition boundary for isolated tests only',sourceIds:[source.id],parcelKeys:[parcel.key]};s.rules=[{jurisdiction:"Test, TX — synthetic county",sourceIds:[source.id],reviewed:true,notes:"Synthetic rules for isolated testing only"}];s.records=[{parcelKey:parcel.key,year:2026,facts:{assessed:{value:100000,sourceId:source.id,stage:"adopted",reviewed:true},market:{value:100000,sourceId:source.id,stage:"adopted",reviewed:true},levied:{value:2000,sourceId:source.id,stage:"issued",reviewed:true}},jurisdictions:[],billEvidence:{kind:'issued_statement',sourceId:source.id,collectorAccount:parcel.accountId,scope:'Synthetic fully reconciled authority scope',notes:'Synthetic source only',obligationStatus:'reconciled'}}];return s;}
