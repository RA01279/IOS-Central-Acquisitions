import { redirect } from 'next/navigation';
import { getServiceClient } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
export const dynamic='force-dynamic';
export default async function Page(props:{params:Promise<{id:string}>}){
  if(!await getCurrentUser())redirect('/login');const {id}=await props.params;
  const {data,error}=await getServiceClient().from('uw_handoffs').select('id').eq('deal_id',id).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw new Error('Could not load handoff.');redirect(data ? `/uw-handoffs/${data.id}` : `/uw-handoffs/new?deal=${id}`);
}
