import {NextRequest,NextResponse,after} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {getServiceClient} from '@/lib/supabase';
import {runTaxBatch} from '@/lib/property-taxes/batch';
export const maxDuration=300;
export async function POST(req:NextRequest){
 if(!await getCurrentUser(req))return NextResponse.json({error:'Not authenticated'},{status:401});
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403});
 let body;try{body=await req.json();}catch{return NextResponse.json({error:'Expected JSON'},{status:400});}
 if(!['property','asset'].includes(body.kind)||!/^[-a-f0-9]{36}$/i.test(body.id))return NextResponse.json({error:'Choose a property or asset'},{status:400});
 const db=getServiceClient(),subject=await db.from(body.kind==='asset'?'assets':'properties').select('id').eq('id',body.id).maybeSingle();
 if(subject.error||!subject.data)return NextResponse.json({error:'Subject unavailable'},{status:404});
 const active=await db.from('property_tax_jobs').select('locked_until,status').eq('subject_kind',body.kind).eq('subject_id',body.id).maybeSingle();
 if(active.data?.status==='processing'&&Date.parse(active.data.locked_until)>Date.now())return NextResponse.json({queued:true,status:'processing'});
 const r=await db.from('property_tax_jobs').upsert({subject_kind:body.kind,subject_id:body.id,status:'queued',attempts:0,next_attempt_at:new Date().toISOString(),lease:null,locked_until:null,updated_at:new Date().toISOString()});
 if(!r.error)after(async()=>{try{await runTaxBatch(db);}catch{console.error('Tax retry background run failed; durable queue retained.');}});
 return NextResponse.json(r.error?{error:'Could not queue tax research'}:{queued:true},{status:r.error?500:200});
}
