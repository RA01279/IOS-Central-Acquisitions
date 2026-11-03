import Nav from '@/components/Nav';
import HandoffEditor from '@/components/HandoffEditor';
import { getServiceClient } from '@/lib/supabase';
import { blankHandoff, seedHandoff } from '@/lib/uw-handoff';
import { getCurrentUser } from '@/lib/auth';
import { notFound,redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
export const dynamic='force-dynamic';
export const metadata={title:'Create UW Handoff'};
export default async function Page(props:{searchParams:Promise<{deal?:string}>}){
  if(!await getCurrentUser())redirect('/login');
  const {deal}=await props.searchParams;let initial=blankHandoff();
  if(deal){if(!/^[0-9a-f-]{36}$/i.test(deal))notFound();const {data,error}=await getServiceClient().from('deals').select('id,contract_price,closing_on,properties(address,city,market,lot_sf,building_sf)').eq('id',deal).maybeSingle();if(error)throw new Error('Could not load deal.');if(!data)notFound();initial=seedHandoff(data);}
  return <><Nav active="uw-handoffs"/><main className="page"><HandoffEditor id={randomUUID()} dealId={deal??null} initial={initial} revision={0} savedAt={null}/></main></>;
}
