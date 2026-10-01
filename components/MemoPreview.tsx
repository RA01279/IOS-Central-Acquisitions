"use client";
import { useState } from "react";
import { MEMO_SLIDES, type MemoDeck } from "@/lib/agents/memo";
// Browser-only exhibit preparation. Files are posted only to Hopper for this download.
const slots = [1,3,4,5,7,8,9,10,11,12,13,14,15,16,17,19,21,23];
type Exhibit={slide:number;data:string;source:string};
async function imageData(file:File):Promise<string>{
 if(!['image/png','image/jpeg'].includes(file.type)||file.size>15000000)throw new Error('Choose a PNG or JPEG under 15 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const g=canvas.getContext('2d');if(!g)throw new Error('Could not prepare image.');g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);g.drawImage(bitmap,0,0,canvas.width,canvas.height);
  let data=canvas.toDataURL('image/jpeg',.84);if(data.length>850000)data=canvas.toDataURL('image/jpeg',.6);if(data.length>850000)throw new Error('Image is too detailed. Crop it and try again.');return data;
 }finally{bitmap.close();}
}
export default function MemoPreview({deck,runId}:{deck:MemoDeck;runId:string}){
 const [exhibits,setExhibits]=useState<Exhibit[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function add(slide:number,file?:File){if(!file)return;setError('');try{const data=await imageData(file);setExhibits(old=>[...old.filter(e=>e.slide!==slide),{slide,data,source:''}]);}catch(e){setError(e instanceof Error?e.message:'Could not read image.');}}
 async function download(){setBusy(true);setError('');try{
  if(exhibits.some(e=>!e.source.trim()))throw new Error('Add a source and date for each selected exhibit.');
  if(exhibits.reduce((n,e)=>n+e.data.length,0)>3200000)throw new Error('The exhibits exceed the download limit. Remove images or use smaller crops.');
  const res=await fetch('/api/agents/powerpoint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:runId,exhibits})});
  if(!res.ok){const d=await res.json();throw new Error(d.error||'Could not download PowerPoint.');}
  const url=URL.createObjectURL(await res.blob());const a=document.createElement('a');a.href=url;a.download=`${deck.property.replace(/[^a-zA-Z0-9 -]/g,'')} - Exec Summary.pptx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){setError(e instanceof Error?e.message:'Could not download PowerPoint.');}finally{setBusy(false);}}
 return <div>
  <p><strong>{deck.property}</strong> · {deck.date} · 25 slides</p>
  <p>Uses your O’Connor executive-summary layout and branding. New deal text and tables are editable. Sources and open items are included in slide notes.</p>
  <button onClick={download} disabled={busy}>{busy?'Preparing PowerPoint…':'Download PowerPoint'}</button>
  {error&&<p role="alert" style={{color:'#a32626'}}>{error}</p>}
  <details style={{margin:'20px 0'}}><summary>Add maps, photos and model exhibits</summary>
   <p>Optional PNG/JPEG images replace the marked exhibit areas. Add the source and date. These images are used for this download only; reselect them for a later download. Missing exhibits remain clearly marked in the deck. Total image budget: approximately 2.4 MB after resizing.</p>
   {slots.map(n=>{const e=exhibits.find(x=>x.slide===n);return <div key={n} style={{padding:'10px 0',borderBottom:'1px solid #ddd'}}>
    <label htmlFor={`memo-image-${n}`}><strong>{n}. {MEMO_SLIDES[n-1][0]}</strong></label><input id={`memo-image-${n}`} type="file" accept="image/png,image/jpeg" style={{display:'block',margin:'8px 0'}} onChange={ev=>void add(n,ev.target.files?.[0])}/>
    {e&&<><label htmlFor={`memo-source-${n}`}>Source and date</label><input id={`memo-source-${n}`} value={e.source} maxLength={500} placeholder="Source name, document date, page or URL" onChange={ev=>setExhibits(old=>old.map(x=>x.slide===n?{...x,source:ev.target.value}:x))} style={{display:'block',width:'100%',maxWidth:650}}/><button type="button" onClick={()=>{setExhibits(old=>old.filter(x=>x.slide!==n));const input=document.getElementById(`memo-image-${n}`) as HTMLInputElement|null;if(input)input.value='';}}>Remove exhibit</button></>}
   </div>;})}
  </details>
  <h3>Slide content</h3>
  {deck.slides.map(s=><details key={s.number} style={{borderBottom:'1px solid #ddd',padding:'12px 0'}}><summary>{s.number}. {s.title}{s.missing.length?' — open items':''}</summary>
   {s.bullets.map((b,i)=><p key={i}>{b}</p>)}
   {s.rows.length>0&&<div style={{overflowX:'auto'}}><table><thead><tr>{s.columns.map((c,i)=><th key={i} style={{padding:8,textAlign:'left'}}>{c}</th>)}</tr></thead><tbody>{s.rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} style={{padding:8,borderTop:'1px solid #ddd'}}>{c}</td>)}</tr>)}</tbody></table></div>}
   {!!s.missing.length&&<><h4>Open items</h4><ul>{s.missing.map((m,i)=><li key={i}>{m}</li>)}</ul></>}
   <h4>Sources</h4><ul>{s.sources.map((v,i)=><li key={i} style={{overflowWrap:'anywhere'}}>{v}</li>)}</ul>
  </details>)}
 </div>;
}
