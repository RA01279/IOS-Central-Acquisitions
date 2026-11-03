import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { handoffFilename, validateHandoff } from '@/lib/uw-handoff';
import { handoffPdf } from '@/lib/uw-handoff-pdf';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,props:{params:Promise<{id:string}>}){
  if(!await getCurrentUser(req))return NextResponse.json({error:'Not authenticated'},{status:401});
  const {id}=await props.params;
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid handoff.'},{status:400});
  const {data,error}=await getServiceClient().from('uw_handoffs').select('title,payload,updated_at,revision').eq('id',id).maybeSingle();
  if(error)return NextResponse.json({error:'Could not load handoff.'},{status:500});
  if(!data)return NextResponse.json({error:'Handoff not found.'},{status:404});
  if(validateHandoff(data.payload))return NextResponse.json({error:'Invalid saved handoff.'},{status:422});
  const expected=req.nextUrl.searchParams.get('revision');
  if(expected && String(data.revision)!==expected)return NextResponse.json({error:'The saved handoff changed. Reload before exporting.'},{status:409});
  const filename=handoffFilename(data.title);
  try {
  const pdf=await handoffPdf(data.payload,data.updated_at,data.revision);
  return new NextResponse(Buffer.from(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${filename.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch { return NextResponse.json({error:'Could not generate PDF. Your saved handoff is unchanged. Please retry.'},{status:500}); }
}
