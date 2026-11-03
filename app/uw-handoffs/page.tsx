import Nav from '@/components/Nav';
import { getServiceClient } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={title:'UW Handoffs'};
export default async function Page(){
  if(!await getCurrentUser())redirect('/login');
  const db=getServiceClient();
  const [saved,deals]=await Promise.all([db.from('uw_handoffs').select('id,title,updated_at,updated_by,deal_id').order('updated_at',{ascending:false}).limit(500),db.from('deals').select('id,ref,properties(address,city)').eq('asset_class','ios').neq('stage','archived').order('created_at',{ascending:false}).limit(1000)]);
  if(saved.error || deals.error)throw new Error('Could not load UW handoffs. Please try again.');
  return <><Nav active="uw-handoffs"/><main className="page"><div className="page-header"><div><span className="overline">IOS ACQUISITIONS</span><h1>UW Handoffs</h1><p className="muted">Enter the assumptions your analyst should model, save, and share.</p></div><a className="btn btn-primary" href="/uw-handoffs/new">Create blank handoff</a></div><section className="panel"><h2>Start From a Deal</h2><form action="/uw-handoffs/new"><label>Hopper deal<select name="deal" required defaultValue=""><option value="" disabled>Select an IOS deal</option>{(deals.data??[]).map((d:any)=><option key={d.id} value={d.id}>{d.properties?.address || 'Unnamed property'}{d.properties?.city ? ` · ${d.properties.city}` : ''} · D-{d.ref}</option>)}</select></label><button type="submit">Create handoff</button></form><p className="hint">Prefills basic deal facts. Every value remains editable.</p></section><section className="panel"><h2>Saved Handoffs</h2>{!saved.data?.length ? <p className="muted">No handoffs yet. Start from a deal or create a blank handoff.</p> : <div className="table-scroll"><table className="summary-table"><thead><tr><th>Property</th><th>Last saved</th><th>Saved by</th><th>Output</th></tr></thead><tbody>{saved.data.map(h=><tr key={h.id}><td><a href={`/uw-handoffs/${h.id}`}>{h.title}</a></td><td>{new Date(h.updated_at).toLocaleString('en-US',{timeZone:'America/Chicago'})} CT</td><td>{h.updated_by}</td><td><a href={`/api/uw-handoffs/${h.id}/export`}>Download handoff</a></td></tr>)}</tbody></table></div>}</section></main></>;
}
