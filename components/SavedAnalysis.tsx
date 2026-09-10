"use client";
import { useEffect, useRef, useState } from "react";

/** Explicit immutable saves; a stale tab cannot overwrite a teammate's review. */
export default function SavedAnalysis({dealId,kind,payload,onRestore,canSave=true}:{dealId:string;kind:"comps"|"demand";payload:unknown;onRestore:(payload:any)=>void;canSave?:boolean}) {
  const restore=useRef(onRestore); restore.current=onRestore;
  const [version,setVersion]=useState(0),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState("Loading saved review…"),[error,setError]=useState("");
  const [savedText,setSavedText]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    fetch(`/api/deals/${dealId}/analysis?kind=${kind}`).then(async response=>{
      const body=await response.json(); if(!response.ok) throw new Error(body.error);
      if(!active) return;
      if(body.saved) {
        restore.current(body.saved.payload); setVersion(body.saved.version);
        setSavedText(JSON.stringify(body.saved.payload));
        setMessage(`Loaded review v${body.saved.version} · ${body.saved.created_by}`);
      } else setMessage("No saved review yet");
      setReady(true);
    }).catch(e=>{if(active){setError(e.message);setMessage("");}});
    return ()=>{active=false;};
  },[dealId,kind]);
  async function save() {
    setBusy(true);setError("");
    const captured=JSON.stringify(payload);
    try {
      const response=await fetch(`/api/deals/${dealId}/analysis`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,expected:version,payload})});
      const body=await response.json(); if(!response.ok) throw new Error(body.error);
      setVersion(body.saved.version);setSavedText(captured);setMessage(`Saved review v${body.saved.version} · ${body.saved.created_by}`);
    } catch(e){setError((e as Error).message);} finally {setBusy(false);}
  }
  const changed=ready && canSave && savedText!==JSON.stringify(payload);
  return <div style={{marginBottom:12}}>
    <button type="button" className="secondary" onClick={save} disabled={!ready||busy||!canSave||!changed}>{busy?"Saving…":"Save reviewed version"}</button>
    <span className="hint" role="status"> {message}{changed?" · Unsaved changes":""}</span>
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
