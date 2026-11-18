import Link from "next/link";
import { getDeal } from "@/lib/deal-workspace";
import { acquisitionBrief, BriefError } from "@/lib/acquisition-brief";
export const dynamic = "force-dynamic";
export const metadata = { title: "Acquisition Brief" };
export default async function AcquisitionBriefPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const deal = await getDeal(id);
  let b;
  try { b = acquisitionBrief(deal, sp.version); }
  catch(e) { if (!(e instanceof BriefError)) throw e; return <section className="panel"><h2>Acquisition Brief</h2><p>{e.message}</p><Link href={`/deals/${id}/financials`}>Return to Financials</Link></section>; }
  const pdf = `/api/deals/${id}/acquisition-brief?version=${encodeURIComponent(b.versionId)}`;
  return <div className="ws-body fin">
    <section className="panel">
      <div className="fin-head"><h2>Acquisition Brief</h2><a className="button-link" href={`${pdf}&download=1`}>Download PDF</a><Link href={`/deals/${id}/financials`}>Financials</Link></div>
      <p className="hint">{b.historical ? "Historical" : "Latest uploaded"} model v{b.versionNumber} · {b.fileName} · {b.uploadedAt ? new Date(b.uploadedAt).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT" : "Upload date not recorded"}</p>
      <form method="get"><label>Model version <select name="version" defaultValue={b.versionId}>{[...(deal.uw_versions ?? [])].sort((a:any,c:any)=>c.version_number-a.version_number).map((v:any)=><option key={v.id} value={v.id}>v{v.version_number} · {v.created_at?.slice(0,10)}</option>)}</select></label> <button type="submit" className="secondary">Preview version</button> <Link href={`/deals/${id}/acquisition-brief`}>Latest upload</Link></form>
      {!b.identityConfirmed && <p className="warning">Draft: model identity is unconfirmed. Resolve the source under Investment evidence and decision on Financials before relying on this brief.</p>}
      <p className="hint">Saved workbook calculations, not recalculated results. Lease and tenant rows are model assumptions; recorded evidence is labeled separately.</p>
      <object data={pdf} type="application/pdf" aria-label={`Acquisition Brief preview for ${b.address}, version ${b.versionNumber}`} style={{ width:"100%", height:"min(1100px, 80vh)", minHeight:420 }}><p><a href={pdf} target="_blank" rel="noreferrer">Open PDF preview</a></p></object>
      <p><a href={pdf} target="_blank" rel="noreferrer">Open full-size preview</a></p>
    </section>
    <section className="panel"><h2>Sources and review notes</h2>
      {b.warnings.length ? <ul className="warning">{b.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul> : <p className="hint">No parser warnings recorded. Confirm all evidence before reliance.</p>}
      <h3>Model assumptions · saved v{b.versionNumber}</h3>
      <dl>{b.assumptions.map(r=><div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
      <h3>Tenant and lease assumptions · saved model</h3>
      {b.tenants.length ? <div className="table-scroll"><table className="summary-table"><thead><tr><th>Tenant</th><th>Start</th><th>Expiration</th><th>Base rent / year</th><th>Market rent / year</th></tr></thead><tbody>{b.tenants.map((t:any,i:number)=><tr key={i}><td>{t.tenant}</td><td>{t.start}</td><td>{t.expiration}</td><td>{t.rent}</td><td>{t.marketRent}</td></tr>)}</tbody></table></div> : <p>Not available in saved model.</p>}
      <h3>Recorded deal evidence</h3><dl>{b.facts.map(r=><div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
    </section>
  </div>;
}
