import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { loadTaxWorkspace, saveTaxWorkspace, TaxError } from "@/lib/property-taxes/store";
import { mergeResearch } from "@/lib/property-taxes/model";
import { researchTaxes } from "@/lib/property-taxes/research";
import {importGwinnettHistory} from '@/lib/property-taxes/gwinnett-history-import';
import {importAssistedBills} from '@/lib/property-taxes/assisted';
import {validTaxEvidencePath} from '@/lib/property-taxes/evidence-path';
import {emptyTaxState} from '@/lib/property-taxes/types';
import {createHash} from 'node:crypto';
export const dynamic="force-dynamic";
export const maxDuration=120;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(e:unknown)=>NextResponse.json({error:e instanceof TaxError ? e.message : "Property tax request failed. Retry; saved research and overrides are preserved."},{status:e instanceof TaxError?e.status:500});
async function context(req:NextRequest,id:string,mutation=false) {
  const user=await getCurrentUser(req); if(!user) throw new TaxError("Not authenticated",401);
  const assetId=id.startsWith('asset:')?id.slice(6):null;
  if(!UUID.test(assetId??id)) throw new TaxError("Invalid property",400);
  if(mutation && req.headers.get("origin")!==req.nextUrl.origin) throw new TaxError("Origin does not match",403);
  const db=getServiceClient();
  const lookup=assetId?await db.from('assets').select('*').eq('id',assetId).maybeSingle():await db.from("deals").select("id,asset_class,properties(*)").eq("id",id).maybeSingle();
  const {error}=lookup,deal=assetId&&lookup.data?{id,asset_class:lookup.data.asset_class,properties:lookup.data}:lookup.data;
  if(error) throw new TaxError("Could not load deal",500); if(!deal) throw new TaxError("Deal not found",404);
  return {db,deal,user};
}
export async function GET(req:NextRequest,props:{params:Promise<{id:string}>}) {
  try {
    const {id}=await props.params,{db}=await context(req,id);
    const workspace=await loadTaxWorkspace(db,id);
    const sourceId=req.nextUrl.searchParams.get("source");
    if(sourceId) {
      const source=workspace.state.sources.find((s:any)=>s.id===sourceId);
      if(!validTaxEvidencePath(id,source?.storagePath)) throw new TaxError("Bill not found",404);
      const {data,error}=await db.storage.from("documents").createSignedUrl(source.storagePath,300);
      if(error || !data) throw new TaxError("Bill unavailable",404);
      return NextResponse.redirect(data.signedUrl);
    }
    const historyResult=id.startsWith('asset:')?await db.from('property_tax_subject_history').select('id,revision,created_at').eq('subject_kind','asset').eq('subject_id',id.slice(6)).order('revision',{ascending:false}).limit(100):await db.from("deal_property_tax_history").select("id,revision,action,actor,created_at").eq("deal_id",id).order("revision",{ascending:false}).limit(100);
    const error=historyResult.error,history=id.startsWith('asset:')?historyResult.data?.map((h:any)=>({...h,action:'saved asset workspace',actor:'Hopper tax workflow'})):historyResult.data;
    if(error) throw new TaxError("Could not load tax history",500);
    const revision=req.nextUrl.searchParams.get("revision");
    if(revision) {
      if(!/^\d+$/.test(revision)) throw new TaxError("Invalid revision");
      const result=id.startsWith('asset:')?await db.from('property_tax_subject_history').select('state,revision,created_at').eq('subject_kind','asset').eq('subject_id',id.slice(6)).eq('revision',Number(revision)).maybeSingle():await db.from("deal_property_tax_history").select("snapshot,revision,created_at,actor").eq("deal_id",id).eq("revision",Number(revision)).maybeSingle();
      const {data,error}=result;
      if(error || !data) throw new TaxError("Revision unavailable",404);
      return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
    }
    return NextResponse.json({...workspace,history},{headers:{"Cache-Control":"no-store"}});
  } catch(e) {return fail(e);}
}
export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}) {
  try {
    const {id}=await props.params,{db,deal,user}=await context(req,id,true);
    if(req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if(Number(req.headers.get("content-length")??0)>3_500_000) throw new TaxError("Use a bill smaller than 3 MB",413);
      const form=await req.formData(),file=form.get("bill"),revision=Number(form.get("revision"));
      if(!(file instanceof File) || file.size>3_000_000 || file.size===0) throw new TaxError("Choose a PDF, PNG or JPEG bill below 3 MB",400);
      const bytes=Buffer.from(await file.arrayBuffer());
      const ext=bytes.subarray(0,5).toString()==="%PDF-"?"pdf":bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"png":bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"jpg":null;
      if(!ext) throw new TaxError("Bill file signature must be PDF, PNG or JPEG");
      const current=await loadTaxWorkspace(db,id);
      if(current.revision!==revision) throw new TaxError("Tax workspace changed. Reload before attaching the bill.",409);
      const path=`deals/${id}/property-taxes/${crypto.randomUUID()}.${ext}`;
      const {error}=await db.storage.from("documents").upload(path,bytes,{contentType:{pdf:"application/pdf",png:"image/png",jpg:"image/jpeg"}[ext],upsert:false});
      if(error) throw new TaxError("Could not store bill",500);
      const state=structuredClone(current.state);
      state.sources.push({id:crypto.randomUUID(),label:file.name.slice(0,150),url:"",retrievedAt:new Date().toISOString(),taxYear:null,kind:"upload",evidence:JSON.stringify({method:'Assisted original attachment; figures require transcription and review',filename:file.name.slice(0,150),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}),storagePath:path});
      const saved=await saveTaxWorkspace(db,id,revision,state,user.email,"upload");
      revalidatePath(`/deals/${id}/property-taxes`);
      return NextResponse.json(saved);
    }
    if(Number(req.headers.get("content-length")??0)>1_500_000) throw new TaxError("Tax workspace is too large",413);
    const raw=await req.text(); if(raw.length>1_500_000) throw new TaxError("Tax workspace is too large",413);
    let body;try{body=JSON.parse(raw);}catch{throw new TaxError("Expected JSON");}
    if(!body || typeof body!=="object" || Array.isArray(body)) throw new TaxError("Expected an action object");
    if(body.action==="save") {
      // Uploaded files may only reference this deal's tax directory.
      for(const s of body.state?.sources??[]) if(s.storagePath && !validTaxEvidencePath(id,s.storagePath)) throw new TaxError("Bill belongs to another workspace",403);
      const saved=await saveTaxWorkspace(db,id,body.revision,body.state,user.email);
      revalidatePath(`/deals/${id}/property-taxes`); return NextResponse.json(saved);
    }
    if(body.action==='import-assisted'){
      const current=await loadTaxWorkspace(db,id);if(body.revision!==current.revision)throw new TaxError('Workspace changed. Reload before importing.',409);
      const parcel=current.state.parcels.find((p:any)=>p.key===body.parcelKey&&p.review!=='excluded');if(!parcel||typeof body.text!=='string')throw new TaxError('Choose an account and retained original records.');
      let capture;try{capture=importAssistedBills(body.text,parcel,current.state.sources,current.state.records);}catch(e){throw new TaxError(e instanceof Error?e.message:'Invalid assisted manifest.');}
      const findings=emptyTaxState();findings.sources=capture.sources;findings.records=capture.records;
      const saved=await saveTaxWorkspace(db,id,current.revision,mergeResearch(current.state,findings),user.email,'review');
      revalidatePath(`/deals/${id}/property-taxes`);return NextResponse.json(saved);
    }
    if(body.action==='import-history'){
      const current=await loadTaxWorkspace(db,id);
      if(body.revision!==current.revision)throw new TaxError('Workspace changed. Reload before importing history.',409);
      const parcel=current.state.parcels.find((p:any)=>p.key===body.parcelKey&&p.review!=='excluded');
      if(!parcel||typeof body.text!=='string'||typeof body.sourceUrl!=='string')throw new TaxError('Choose a subject account and copy its official account history.');
      let capture;try{capture=importGwinnettHistory(body.text,body.sourceUrl,parcel);}catch(e){throw new TaxError(e instanceof Error?e.message:'Could not validate county history.');}
      const findings=emptyTaxState();findings.sources=[capture.source];findings.records=capture.records;
      const state=mergeResearch(current.state,findings);
      const saved=await saveTaxWorkspace(db,id,current.revision,state,user.email,'review');
      revalidatePath(`/deals/${id}/property-taxes`);return NextResponse.json(saved);
    }
    if(body.action!=="research") throw new TaxError("Choose save, research or import-history");
    const current=await loadTaxWorkspace(db,id);
    if(body.revision!==current.revision) throw new TaxError("Workspace changed. Reload before researching.",409);
    const eventsResult=id.startsWith('asset:')?{data:[]}:await db.from("deal_events").select("detail,created_at").eq("deal_id",id).eq("event_type","sourcing_research").order("created_at",{ascending:false}).limit(3);
    const events=eventsResult.data;
    const p:any=Array.isArray(deal.properties)?deal.properties[0]:deal.properties;
    if(!p?.address) throw new TaxError("Add the subject address first.",422);
    const encoder=new TextEncoder();
    const stream=new ReadableStream({async start(controller) {
      const send=(data:unknown)=>{try{controller.enqueue(encoder.encode(JSON.stringify(data)+"\n"));}catch{/* disconnected; still preserve completed evidence */}};
      try {
        const findings=await researchTaxes({address:p.address,city:p.city,state:p.state,latitude:p.latitude==null?null:Number(p.latitude),longitude:p.longitude==null?null:Number(p.longitude),precision:p.geocode_precision,existingEvidence:events?.length?events:undefined},current.state,(message,partial)=>send({type:"progress",message,partial}),fetch,async(source,bytes,contentType)=>{
          const hash=createHash('sha256').update(bytes).digest('hex');
          const path=`deals/${id}/property-taxes/${source.id}-${hash}.${contentType==='application/pdf'?'pdf':'json'}`;
          const {error}=await db.storage.from('documents').upload(path,bytes,{contentType,upsert:false});
          if(error)throw new Error('County evidence retrieved but original document could not be retained. Retry; saved history is preserved.');
          source.storagePath=path;
        });
        const state=mergeResearch(current.state,findings);
        const saved=await saveTaxWorkspace(db,id,current.revision,state,user.email,"research");
        revalidatePath(`/deals/${id}/property-taxes`);
        send({type:"complete",workspace:saved});
      } catch(e) {send({type:"error",error:e instanceof Error?e.message:"Research interrupted. Retry.",status:e instanceof TaxError?e.status:500});}
      finally {try{controller.close();}catch{/* disconnected */}}
    }});
    return new Response(stream,{headers:{"Content-Type":"application/x-ndjson","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }catch(e){return fail(e);}
}
