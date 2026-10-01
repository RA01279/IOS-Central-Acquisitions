"use client";
import { useState } from "react";
import type { Zoning, ZoningCandidate, ZoningReport } from "@/lib/zoning/types";

function designation(z:Zoning) { return [z.district,z.specialUse,z.plannedDevelopment,z.subarea,...z.overlays].filter(Boolean).join(" | "); }
function Source({url,children}:{url:string;children:React.ReactNode}) {
  return <a href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
}
function Candidate({candidate:c}:{candidate:ZoningCandidate}) {
  return <article style={{borderTop:"1px solid var(--border, #ddd)",padding:"12px 0"}}>
    <strong>{c.name}</strong> <span className="muted">- {c.distanceMi.toFixed(2)} mi</span>
    <p>{c.address} | {c.zoning ? designation(c.zoning) : "Outside subject municipality"}</p>
    <p><strong>{c.evidence?.category??c.category}</strong>{!c.evidence && " (search category; use unverified)"}</p>
    {c.match==="same_code" && <p className="hint">Published code matches; separate overlays and site permits need verification.</p>}
    {c.match==="same_base" && <p className="hint">Same base district; special-use, planned-development or overlay provisions differ.</p>}
    <p>{c.evidence?.use??"Confirm outdoor operations at this address before using it as an IOS comparable."}</p>
    <p className="hint"><Source url={c.mapsUrl}>Business listing / map</Source>
      {c.zoning && <> | <Source url={c.zoning.sourceUrl}>Zoning source</Source></>}
      {c.evidence && <> | <Source url={c.evidence.url}>Site-use evidence</Source> (reviewed {c.evidence.checkedOn}; {c.evidence.outdoorUse?"outdoor use supported":"outdoor use unverified"})</>}
    </p>
  </article>;
}
export default function ZoningResearchPanel({dealId}:{dealId:string}) {
  const [radius,setRadius]=useState(3);
  const [report,setReport]=useState<ZoningReport|null>(null);
  const [busy,setBusy]=useState<"lookup"|"neighbors"|null>(null);
  const [error,setError]=useState("");
  const [unsupported,setUnsupported]=useState(false);
  const researchHref="/agents?agent=site-research&deal="+encodeURIComponent(dealId)+"&task=zoning-ios&radius="+radius;
  const [neighborsLoaded,setNeighborsLoaded]=useState(false);
  async function request(action:"lookup"|"neighbors") {
    const response=await fetch(`/api/deals/${dealId}/zoning`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,radiusMiles:radius})});
    const data=await response.json().catch(()=>({error:"Research did not finish. Please retry."}));
    if(!response.ok) {
      if(data.code==="UNSUPPORTED_MUNICIPALITY"){setUnsupported(true);return null;}
      throw new Error(data.error??"Research failed.");
    }
    return data.report as ZoningReport;
  }
  async function generate() {
    setBusy("lookup");setError("");setUnsupported(false);setNeighborsLoaded(false);setReport(null);
    try {
      const lookup=await request("lookup");
      if(!lookup)return;
      setReport(lookup);
      setBusy("neighbors");
      setReport(await request("neighbors"));
      setNeighborsLoaded(true);
    }catch(e){setError(e instanceof Error?e.message:"Research failed.");}
    finally{setBusy(null);}
  }
  function download() {
    if(!report) return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="zoning-research-"+dealId+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const matches=report?.candidates.filter(c=>["same_designation","same_code"].includes(c.match))??[];
  const base=report?.candidates.filter(c=>c.match==="same_base")??[];
  const others=report?.candidates.filter(c=>!["same_designation","same_code","same_base"].includes(c.match))??[];
  return <section className="panel" aria-labelledby="zoning-research-heading">
    <h2 id="zoning-research-heading">Zoning & nearby IOS users</h2>
    <p>Instant public-map lookup: Plano, Dallas, Fort Worth and Austin. Use U.S. zoning research for other municipalities and deeper tenant verification.</p>
    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <label htmlFor="zoning-radius">Search radius</label>
      <select id="zoning-radius" value={radius} disabled={busy!==null} onChange={e=>setRadius(Number(e.target.value))}>
        <option value={1}>1 mile</option><option value={3}>3 miles</option><option value={5}>5 miles</option>
      </select>
      <button type="button" disabled={busy!==null} onClick={generate}>{busy==="lookup"?"Looking up zoning...":busy==="neighbors"?"Checking nearby operators...":"Check zoning & nearby users"}</button>
      {report && <button type="button" className="secondary" onClick={download}>Download research</button>}
    </div>
    {busy && <p role="status">{busy==="lookup"?"Checking public zoning...":"Zoning is ready. Checking nearby businesses against the municipal zoning map."}</p>}
    {unsupported && <div role="status" style={{padding:16,marginTop:16,background:"#eff6f2",border:"1px solid #c5d9ce",borderRadius:6}}><strong>This property needs sourced research</strong><p>Its municipality is outside the instant-map coverage. Continue with your connected computer helper to research zoning and nearby IOS operators. Your property and search radius will be selected.</p><a className="button" href={researchHref}>Research this property</a></div>}
    <p><a href={researchHref}>U.S. zoning and tenant research</a> - Requires the connected Hopper computer helper. Sourced research takes longer than instant lookup.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {report && <div aria-live="polite">
      <h3>{report.address} | {report.municipality}</h3>
      <p><strong>{designation(report.subject)}</strong> - {report.subject.description}</p>
      <p className="hint">Zoning checked {new Date(report.generatedAt).toLocaleString()} | Search radius: {report.radiusMiles} miles
        {report.providerUpdated && <> | Provider data updated: {report.providerUpdated}</>}
      </p>
      <p><Source url={report.subject.sourceUrl}>Zoning source</Source></p>
      <h3>Same municipality and {report.subject.modifiersVerified===false?"published zoning code":"full mapped designation"} ({matches.length})</h3>
      {!neighborsLoaded && <p>{busy==="neighbors"?"Matches are loading...":"Neighbor search is incomplete. Retry to load matches."}</p>}
      {neighborsLoaded && !matches.length && <p>No matching designations found in this quick search.</p>}
      {matches.map(c=><Candidate key={c.placeId} candidate={c}/>)}
      {neighborsLoaded && <><h3>Same base zoning, different site provisions ({base.length})</h3>{!base.length && <p>No additional base-district matches found.</p>}{base.map(c=><Candidate key={c.placeId} candidate={c}/>)}</>}
      {neighborsLoaded && <details><summary>Other candidates checked ({others.length})</summary>
        {others.map(c=><div key={c.placeId}><p className="hint">{c.match==="outside"?"Different municipality":c.match==="different"?"Different zoning code":"Zoning check unavailable"}</p><Candidate candidate={c}/></div>)}
      </details>}
      <details style={{marginTop:16}}><summary>Sources and research scope</summary>
        <ul>{report.warnings.map(w=><li key={w}>{w}</li>)}</ul>
        <p>Business listings: Google Maps. Zoning and municipality: {report.subject.provider}. Download a copy to retain this report; it is not saved to the deal.</p>
      </details>
    </div>}
  </section>;
}
