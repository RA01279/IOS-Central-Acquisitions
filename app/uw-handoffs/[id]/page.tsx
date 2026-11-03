import Nav from '@/components/Nav';
import HandoffEditor from '@/components/HandoffEditor';
import { getServiceClient } from '@/lib/supabase';
import { validateHandoff } from '@/lib/uw-handoff';
import { getCurrentUser } from '@/lib/auth';
import { notFound,redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={title:'Edit UW Handoff'};
export default async function Page(props:{params:Promise<{id:string}>}){
  if(!await getCurrentUser())redirect('/login');const {id}=await props.params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
  const {data,error}=await getServiceClient().from('uw_handoffs').select('*').eq('id',id).maybeSingle();if(error)throw new Error('Could not load handoff.');if(!data)notFound();if(validateHandoff(data.payload))throw new Error('Saved handoff format is invalid.');
  return <><Nav active="uw-handoffs"/><main className="page"><HandoffEditor id={id} dealId={data.deal_id} initial={data.payload} revision={data.revision} savedAt={data.updated_at}/></main></>;
}
