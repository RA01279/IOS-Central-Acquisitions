import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { validateHandoff } from '@/lib/uw-handoff';
export const dynamic='force-dynamic';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(req:NextRequest){
  const user=await getCurrentUser(req);if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
  const text=await req.text();if(Buffer.byteLength(text)>250000)return NextResponse.json({error:'Handoff is too large.'},{status:413});
  let b;try{b=JSON.parse(text);}catch{return NextResponse.json({error:'Invalid request.'},{status:400});}
  const invalid=validateHandoff(b?.payload);
  if(invalid || !UUID.test(b?.id??'') || !Number.isInteger(b?.expected) || b.expected<0 || (b.dealId!==null && !UUID.test(b.dealId??'')))return NextResponse.json({error:invalid || 'Invalid handoff request.'},{status:400});
  const db=getServiceClient();
  if(b.dealId){const {data,error}=await db.from('deals').select('id').eq('id',b.dealId).maybeSingle();if(error || !data)return NextResponse.json({error:'The linked deal could not be found.'},{status:400});}
  const row={title:b.payload.overview.property.trim() || 'Untitled IOS handoff',payload:b.payload,updated_by:user.email,updated_at:new Date().toISOString(),revision:b.expected+1};
  const query=b.expected===0 ? db.from('uw_handoffs').insert({...row,id:b.id,deal_id:b.dealId}) : db.from('uw_handoffs').update(row).eq('id',b.id).eq('revision',b.expected);
  const {data,error}=await query.select('id,revision,updated_at').maybeSingle();
  if(error || !data)return NextResponse.json({error:error?.code==='23505' || !error ? 'This handoff changed in another window. Reload before saving; your current edits are still shown.' : 'Could not save the handoff. Your edits are still shown.'},{status:error?.code==='23505' || !error ? 409:500});
  return NextResponse.json({saved:data});
}
