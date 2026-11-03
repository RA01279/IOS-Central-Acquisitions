import {decisionReport} from "@/lib/decision-report";
const usd=(v:number|null)=>v==null?"Unknown":`$${v.toLocaleString()}`;
export default function DecisionContext({deal}:{deal:any}) {
 const d=decisionReport(deal);
 return <details className="panel fin-collapse"><summary><h2>Decision and source reconciliation</h2><span className="fin-collapse-meta">{d.status??"Decision status unknown"} · Owner: {d.owner??"Unassigned"}</span></summary>
 <p><a href={`/deals/${deal.id}/diligence`}>Open original documents and workbook attachments</a></p>
 <p>{d.status??"Decision status unknown"} · Owner: {d.owner??"Unassigned"} · Vehicle / partner: {d.vehicle??"Unknown"}</p>
 <p>Pursuit rationale: {d.rationale??"Unknown"}</p>
 <p>Asking guidance: {usd(d.askingPrice)} · {d.askingDate??"Date unknown"} · {d.askingSource??"Source unknown"}<br/>Model price: {usd(d.modelPrice)} · {d.returnSource}<br/>Latest bid: {usd(d.latestBid)} · {d.bidDate??"Date unknown"}</p>
 <p>Workbook IRR: {d.modelIrr==null?"Withheld / unknown":`${(d.modelIrr*100).toFixed(2)}%`} · Latest saved screening IRR: {d.screeningIrr==null?"Unknown":`${(d.screeningIrr*100).toFixed(2)}%`} · {d.screenDate??"No saved screening run"}</p>
 <p>{d.income}. {d.currentBaseRent===0?"Current annual base rent: $0 (vacant).":d.currentBaseRent!=null?`Current annual base rent: ${usd(d.currentBaseRent)}.`:"Current base rent requires source verification."} Income effective: {d.incomeEffectiveDate??"Unknown"}.</p>
 <p>{d.bridge}</p><p>{d.assumptions}</p><p>Comp review: {d.compReview}</p><p>Downside drivers: {d.downside??"Not recorded"}</p>
 <p className="warning">{d.conflicts||"No detected conflicts; this is not investment approval."}</p>
 <p>Requested action: {d.nextAction??"Unknown"} · Follow-up: {d.followUpOn??"Unassigned"} · Offer deadline: {d.deadline??"Unknown"} · {d.deadlineSource??"Deadline source unknown"}</p>
 </details>;
}
