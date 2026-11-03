import {htmlText} from './collector-http';
import type {TaxSource,RetainTaxEvidence} from './types';
import {jurisdictionKey} from './accounts';
import {inspectOfficialLink,type SourceCheck} from './source-inspection';
export {jurisdictionKey} from './accounts';
export const TX_DIRECTORY='https://comptroller.texas.gov/taxes/property-tax/county-directory/';
export const GA_DIRECTORY='https://dor.georgia.gov/county-property-tax-facts';
const TABLE_DIRECTORIES:Record<string,string>={CA:'https://boe.ca.gov/proptaxes/countycontacts.htm',WA:'https://dor.wa.gov/taxes-rates/property-tax/county-assessor-and-treasurer-websites',FL:'https://floridarevenue.com/property/Pages/LocalOfficials.aspx',MD:'https://dat.maryland.gov/pages/tax-collectors.aspx'};
const VERIFIED_COUNTY_SEEDS:Record<string,string>={'CO:adams':'https://adamscountyco.gov/our-county/elected-officials/treasurer-public-trustee/treasurer-division/','NJ:middlesex':'https://www.middlesexcountynj.gov/government/departments/department-of-finance/board-of-taxation'};
export interface TaxDiscovery {jurisdiction:string;status:'adapter_available'|'onboarding_required'|'directory_unavailable';adapter?:string;sourceIds:string[];officialLinks:{label:string;url:string}[];interfaceChecks?:SourceCheck[];nextSteps:string[];at:string;}
export function adapterFor(state:string,county:string){return ({'TX:dallas':'act-dallas','TX:bexar':'act-bexar','TX:montgomery':'act-modern-montgomery-current-payments','TX:harris':'harris','TX:travis':'go2gov-travis','GA:gwinnett':'gwinnett'} as Record<string,string>)[jurisdictionKey(state,county)];}
function links(html:string,base:string){return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{try{const u=new URL(m[1].replace(/&amp;/g,'&'),base);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?[{label:htmlText(m[2]),url:u.href}]:[];}catch{return [];}});}
// Discover only from verified government directories. External links are leads
// until an onboarding review verifies the official chain and adapter contract.
// No URL is manufactured from a county name or accepted from an arbitrary user.
export async function discoverTaxSources(state:string,county:string,fetcher:typeof fetch=fetch,retain?:RetainTaxEvidence,inspect=false){
 const at=new Date().toISOString(),key=jurisdictionKey(state,county),adapter=adapterFor(state,county),sources:TaxSource[]=[];
 const result:TaxDiscovery={jurisdiction:key,status:adapter?'adapter_available':'onboarding_required',adapter,sourceIds:[],officialLinks:[],at,nextSteps:adapter?['Verify candidate account and situs against the collector.','Retrieve dated originals; reconcile each authority and identify separate collectors.']:['Locate the county assessor and every collector through official government links.','Retain the official link chain and inspect public search, statement, history and payment interfaces.','Test an existing portal adapter against original records; enable county configuration only after independent reconciliation.','If interactive access is demonstrated, retain the access response and use the official browser workflow to capture original records.','Keep account, year, authority and parcel-set gaps unresolved until evidence supports them.']};
 const direct=VERIFIED_COUNTY_SEEDS[key];const directory=direct??(state.toUpperCase()==='TX'?TX_DIRECTORY:state.toUpperCase()==='GA'?GA_DIRECTORY:TABLE_DIRECTORIES[state.toUpperCase()]??null);
 if(!directory){result.nextSteps.unshift('Official directory seed required for this state; source investigation remains open, not a completed search.');return {discovery:result,sources};}
 async function read(url:string){const r=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`Official directory HTTP ${r.status}`);const raw=await r.text();if(raw.length>2_000_000)throw Error('Official directory response too large.');const s:TaxSource={id:crypto.randomUUID(),label:'Official tax source directory — discovery evidence, not bill coverage',url,retrievedAt:at,taxYear:null,kind:'official',evidence:raw.slice(0,60000)};if(retain)await retain(s,new TextEncoder().encode(JSON.stringify({url,retrievedAt:at,html:raw})),'application/json');sources.push(s);result.sourceIds.push(s.id);return raw;}
 try{const html=await read(directory),wanted=county.replace(/\s+county$/i,'').trim().toLowerCase();
  if(direct){result.officialLinks=[{label:'Verified official county source',url:direct},...links(html,direct).filter(l=>/tax|collector|treasurer|assessor|property records|search/i.test(l.label)).slice(0,40)];if(state.toUpperCase()==='NJ')result.nextSteps.unshift('Identify the governing municipality and its collector; a county assessment/tax-board record is not an issued municipal bill.');if(inspect)await inspectLinks();return {discovery:result,sources};}
  if(TABLE_DIRECTORIES[state.toUpperCase()]){
   const norm=(s:string)=>htmlText(s).replace(/county/gi,'').replace(/\u200b/g,'').trim().toLowerCase();
   const rows=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].filter(m=>{const first=m[1].match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1];return first&&norm(first)===wanted;});
   result.officialLinks=[{label:'Official statewide assessor / collector directory',url:directory},...rows.flatMap(m=>links(m[1],directory))];
   if(result.officialLinks.length===1){const matching=links(html,directory).filter(l=>norm(l.label).includes(wanted)&&/tax|collector|treasurer|assessor|property/i.test(l.label));result.officialLinks.push(...matching);}
   if(result.officialLinks.length===1)result.nextSteps.unshift('Official directory located; county-specific links require assisted inspection of its published interface. No collector URL was guessed.');
   if(inspect)await inspectLinks();return {discovery:result,sources};
  }
  const match=links(html,directory).filter(l=>l.label.replace(/^\d+\s+/,'').replace(/\s+county$/i,'').trim().toLowerCase()===wanted);
  if(match.length!==1)throw Error('Official directory did not uniquely identify the county; review required.');
  // Only follow a county page on the same verified government directory host.
  if(new URL(match[0].url).origin!==new URL(directory).origin)throw Error('County directory link needs official-chain review.');
  const countyHtml=await read(match[0].url);result.officialLinks=[match[0],...links(countyHtml,match[0].url).filter(l=>/website|appraisal|assessor|collector|tax office|tax commissioner|^www\.|^https?:\/\//i.test(l.label))];
 }catch(e){if(!adapter)result.status='directory_unavailable';result.nextSteps.unshift(`Directory investigation unresolved: ${e instanceof Error?e.message:String(e)}`);}
 if(inspect)await inspectLinks();return {discovery:result,sources};
 async function inspectLinks(){
  if(adapter)return;
  const leads=[...new Map(result.officialLinks.filter(l=>new URL(l.url).origin!==new URL(directory!).origin).map(l=>[l.url,l])).values()].slice(0,3);
  for(const lead of leads){const r=await inspectOfficialLink(lead.url,fetcher,retain);(result.interfaceChecks??=[]).push(r.check);sources.push(...r.sources);result.sourceIds.push(...r.sources.map(s=>s.id));await new Promise(r=>setTimeout(r,350));}
 }
}
