// Public collector sessions only. Origins and every redirect are checked;
// cookies stay in this server-side request and are never persisted as evidence.
const ORIGINS=new Set(['https://www.hctax.net','https://www.dallasact.com','https://bexar.acttax.com','https://actweb.acttax.com','https://travis.go2gov.net','https://www.gwinnetttaxcommissioner.com']);
export class CollectorSession {
 private cookies=new Map<string,string>();
 constructor(private fetcher:typeof fetch=fetch){}
 async read(input:string,options:{referer?:string;ajax?:boolean;binary?:boolean;form?:URLSearchParams}={}){
  let url=new URL(input);
  for(let n=0;n<4;n++){
   if(!ORIGINS.has(url.origin)||url.username||url.password)throw Error('Collector URL is outside the approved official hosts.');
   const cookie=this.cookies.get(url.origin)??'';
   const response=await this.fetcher(url.toString(),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000),...(options.form?{method:'POST',body:options.form}:{}),headers:{Accept:options.binary?'application/pdf':'text/html,application/json',...(options.form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(cookie?{Cookie:cookie}:{}),...(options.referer?{Referer:options.referer}:{}),...(options.ajax?{'X-Requested-With':'XMLHttpRequest'}:{})}});
   const jar=new Map(cookie.split('; ').filter(Boolean).map(x=>{const p=x.indexOf('=');return [x.slice(0,p),x.slice(p+1)];}));
   for(const c of response.headers.getSetCookie()){const first=c.split(';')[0],p=first.indexOf('=');if(p>0)jar.set(first.slice(0,p),first.slice(p+1));}
   this.cookies.set(url.origin,[...jar].map(([k,v])=>`${k}=${v}`).join('; '));
   if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!next)throw Error('Collector redirect has no target.');url=new URL(next,url);continue;}
   if(!response.ok)throw Error(`Official collector returned HTTP ${response.status}; interactive access or retry may be required.`);
   const limit=options.binary?4_000_000:2_000_000;if(Number(response.headers.get('content-length')??0)>limit)throw Error('Collector response exceeds the research limit.');
   const reader=response.body?.getReader();if(!reader)throw Error('Empty collector response.');const chunks:Uint8Array[]=[];let size=0;
   while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit){await reader.cancel();throw Error('Collector response exceeds the research limit.');}chunks.push(item.value);}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
   const text=new TextDecoder().decode(bytes);
   if(!options.binary&&/g-recaptcha|cf-chl-|verify you are human|access denied|direct access to this page is not allowed/i.test(text))throw Error('Official collector requires interactive access. No access controls were bypassed.');
   return {url:url.toString(),text,bytes,contentType:response.headers.get('content-type')??''};
  }
  throw Error('Too many collector redirects.');
 }
}
export function htmlText(value:string){return value.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();}
export function tableRows(html:string){return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>htmlText(c[1])));}
export function collectorAmount(raw:string):number|null {const value=raw.trim().replace(/[$,\s]/g,'');return /^\d+(?:\.\d{1,6})?$/.test(value)?Number(value):null;}
