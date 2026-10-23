'use client';
import {useState} from 'react';
import type {TaxState} from '@/lib/property-taxes/types';
export default function TaxHistoryImport({state,disabled,onImport}:{state:TaxState;disabled:boolean;onImport:(parcelKey:string,text:string,sourceUrl:string)=>Promise<boolean>}){
 const accounts=state.parcels.filter(p=>p.review!=='excluded'&&p.state==='GA'&&p.county.toLowerCase().replace(/ county$/,'')==='gwinnett');
 const [key,setKey]=useState(''),[text,setText]=useState(''),[url,setUrl]=useState('');if(!accounts.length)return null;
 return <details className="panel"><summary>Import history from the official interactive county portal</summary>
  <p>Gwinnett requires a browser verification before showing older bills. <a href="https://www.gwinnetttaxcommissioner.com/pay" target="_blank" rel="noreferrer">Open official county portal</a>, complete its verification, search the account and open Account Details. Copy the page text, including Parcel ID, Site Address and the Tax Bills table. Paste it here with the account page URL.</p>
  <p className="hint">Hopper verifies the account, situs address, year columns and monetary reconciliation. The capture is retained as a user import for review; it is not described as automated research. Browser sessions and verification credentials are never copied.</p>
  <label>Subject account<select value={key||accounts[0].key} onChange={e=>setKey(e.target.value)} disabled={disabled}>{accounts.map(p=><option key={p.key} value={p.key}>{p.accountId} · {p.address}</option>)}</select></label>
  <label>Official account page URL<input value={url} type="url" onChange={e=>setUrl(e.target.value)} disabled={disabled}/></label>
  <label>Copied official account page<textarea value={text} rows={8} onChange={e=>setText(e.target.value)} disabled={disabled}/></label>
  <button type="button" disabled={disabled||!text.trim()||!url.trim()} onClick={async()=>{if(await onImport(key||accounts[0].key,text,url))setText('');}}>Import and save historical bills</button>
 </details>;
}
