import Nav from '@/components/Nav';
import PropertyTaxes from '@/components/property-taxes/PropertyTaxes';
import {getCurrentUser} from '@/lib/auth';
import {getServiceClient} from '@/lib/supabase';
import {redirect,notFound} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function AssetTaxPage({params}:{params:Promise<{id:string}>}){if(!await getCurrentUser())redirect('/login');const {id}=await params;if(!/^[a-f0-9-]{36}$/i.test(id))notFound();const {data,error}=await getServiceClient().from('assets').select('address,asset_class').eq('id',id).maybeSingle();if(error||!data)notFound();return <><Nav/><main style={{maxWidth:1300,margin:'32px auto',padding:'0 24px'}}><PropertyTaxes dealId={`asset:${id}`} address={data.address} ios={data.asset_class!=='industrial'}/></main></>;}
