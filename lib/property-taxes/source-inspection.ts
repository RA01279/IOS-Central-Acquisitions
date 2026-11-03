import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {htmlText} from './collector-http';
import type {TaxSource,RetainTaxEvidence} from './types';
export interface SourceCheck {url:string;at:string;status:number|null;access:'public_page'|'interactive_verification'|'http_error'|'transport_failure';portalFamily:string|null;publishedInterfaces:{label:string;url:string}[];message:string;}
export function isAccessChallenge(html:string){return /cf-chl-|<title[^>]*>[^<]*(?:just a moment|access denied)|security verification|verify you are human/i.test(html);}
function publicIP(ip:string){if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127);}const v=ip.toLowerCase();return isIP(ip)===6&&!v.startsWith('fc')&&!v.startsWith('fd')&&!v.startsWith('fe80')&&!v.startsWith('::')&&v!=='::1';}
async function publicURL(value:string){const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw Error('Unapproved source URL format.');const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicIP(a.address)))throw Error('Source does not resolve exclusively to a public address.');return u;}
// Call only on links emitted by the fixed official government directory reader.
// This is interface discovery, never parcel matching or a completed bill search.
export async function inspectOfficialLink(value:string,fetcher:typeof fetch=fetch,retain?:RetainTaxEvidence){
 const at=new Date().toISOString(),check:SourceCheck={url:value,at,status:null,access:'transport_failure',portalFamily:null,publishedInterfaces:[],message:''};const sources:TaxSource[]=[];
 try{let url=await publicURL(value);let response:Response|undefined;
  for(let n=0;n<4;n++){response=await fetcher(url.href,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!next)throw Error('Official source redirect has no target.');url=await publicURL(new URL(next,url).href);continue;}break;}
  if(!response)throw Error('No public response.');check.url=url.href;check.status=response.status;
  const reader=response.body?.getReader();if(!reader)throw Error('Empty public response.');let bytes=0,raw='';const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2_000_000){await reader.cancel();throw Error('Official page exceeds inspection limit.');}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();
  check.access=isAccessChallenge(raw)?'interactive_verification':response.ok?'public_page':'http_error';
  check.portalFamily=/acttax\.com|dallasact\.com/.test(url.hostname)?'ACT':/go2gov\.net/.test(url.hostname)?'Go2Gov':/taxandrevenue\.opengov\.com/.test(url.hostname)?'OpenGov':/county-taxes\./.test(url.hostname)?'TaxSys':null;
  check.publishedInterfaces=[...raw.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{const label=htmlText(m[2]);if(!/tax|property|parcel|bill|statement|receipt|account|payment|search/i.test(label))return [];try{const u=new URL(m[1].replace(/&amp;/g,'&'),url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?[{label:label.slice(0,500),url:u.href}]:[];}catch{return [];}}).slice(0,40);
  check.message=check.access==='public_page'?'Public official page inspected; published interfaces are leads requiring account and original-record validation.':check.access==='interactive_verification'?'This exact official endpoint returned an access-verification page. Browser-assisted capture is required unless a separate published public interface is verified.':`Official endpoint returned HTTP ${response.status}; this does not establish that its records are unavailable.`;
  const source:TaxSource={id:crypto.randomUUID(),label:'Official public interface investigation — not bill evidence',url:url.href,retrievedAt:at,taxYear:null,kind:'official',evidence:JSON.stringify({check,excerpt:htmlText(raw).slice(0,30000)})};if(retain)await retain(source,new TextEncoder().encode(JSON.stringify({requestedUrl:value,url:url.href,at,status:response.status,html:raw})),'application/json');sources.push(source);
 }catch(e){check.message=`Source investigation unresolved: ${e instanceof Error?e.message:String(e)}. No conclusion about public record availability.`;}
 return {check,sources};
}
