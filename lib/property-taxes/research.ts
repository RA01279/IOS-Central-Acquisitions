// Server-side only. Fixed official endpoints; never fetch a user-supplied URL.
import { geocodeAddress, normaliseState, resolveState } from "../geocode";
import { emptyTaxState, type TaxState, type TaxSource, type TaxParcel } from "./types";
import { matchParcel, parcelKey } from "./model";
import {normalizedAddress} from './address';
import {parseGwinnettBill,gwinnettPdfText} from './gwinnett';

export const TX_PARCELS = "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0";
export const GA_PARCELS = "https://services3.arcgis.com/RfpmnkSAQleRbndX/ArcGIS/rest/services/Property_and_Tax/FeatureServer/0";
const GA_MASTER = "https://services3.arcgis.com/RfpmnkSAQleRbndX/ArcGIS/rest/services/Property_and_Tax/FeatureServer/3";
export interface TaxSubject { address: string; city?: string; state?: string; county?: string; latitude?: number | null; longitude?: number | null; precision?: string; existingEvidence?: unknown }
type Emit = (message: string, report: TaxState) => void;
const text = (v: unknown) => {const value=v==null?"":String(v).trim();return /^(null|<null>|undefined)$/i.test(value)?"":value;};
const numeric = (v: unknown) => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const sql = (v: string) => v.replace(/'/g, "''");
export function officialQuery(layer: string, params: Record<string,string>) {
  const url = new URL(layer + "/query");
  url.search = new URLSearchParams({ f: "json", outFields: "*", returnGeometry: "false", resultRecordCount: "30", ...params }).toString();
  return url.toString();
}
export function texasIdentify(lat:number,lng:number) {
  const url=new URL(TX_PARCELS.replace(/\/0$/,"")+"/identify"),d=0.001;
  url.search=new URLSearchParams({f:"json",geometry:`${lng},${lat}`,geometryType:"esriGeometryPoint",sr:"4326",layers:"all:0",tolerance:"0",mapExtent:[lng-d,lat-d,lng+d,lat+d].join(","),imageDisplay:"400,400,96",returnGeometry:"false"}).toString();
  return url.toString();
}
async function read(url: string, json: boolean, fetcher: typeof fetch) {
  const response = await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(9000), headers: { Accept: json ? "application/json" : "text/html" } });
  if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length") ?? 0) > 2_000_000) throw new Error("Official response exceeds the research limit.");
  const reader = response.body?.getReader(); if (!reader) throw new Error("Empty official response.");
  let raw = "", bytes = 0; const decoder = new TextDecoder();
  while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw new Error("Official response exceeds the research limit."); } raw += decoder.decode(chunk.value, { stream: true }); }
  raw += decoder.decode();
  if (!json) return raw;
  const value = JSON.parse(raw);
  if (value.error) throw new Error("Official GIS reported an error; no values inferred.");
  if (value.exceededTransferLimit) throw new Error("Official GIS result was truncated; narrow the parcel match.");
  return value;
}
function addSource(report: TaxState, label: string, url: string, evidence: unknown, year: number | null = null): TaxSource {
  const source: TaxSource = { id: crypto.randomUUID(), label, url, retrievedAt: new Date().toISOString(), taxYear: year, kind: "official", evidence: typeof evidence === "string" ? evidence.slice(0, 60000) : JSON.stringify(evidence).slice(0, 60000) };
  report.sources.push(source); return source;
}
export function texasParcel(attributes: Record<string,unknown>, subject: TaxSubject, source: TaxSource): { parcel: TaxParcel; year: number | null; market: number | null } | null {
  const a = Object.fromEntries(Object.entries(attributes).map(([k,v]) => [k.toLowerCase(),v]));
  const accountId = text(a.prop_id), county = text(a.county);
  if (!accountId || !county) return null;
  const key = parcelKey("TX", county, accountId);
  const match = matchParcel(subject, { address: text(a.situs_addr), county, state: "TX" }, true);
  const rawYear = numeric(a.tax_year), year = rawYear && Number.isInteger(rawYear) && rawYear >= 1900 && rawYear <= 2200 ? rawYear : null;
  return { parcel: { key, accountId, county, state: "TX", address: text(a.situs_addr), owner: text(a.owner_name), legal: text(a.legal_desc), sourceIds: [source.id], matchEvidence: match.evidence, review: "pending", reviewNote: "", component: "unknown", assessmentGroup: text(a.geo_id) || accountId }, year, market: numeric(a.mkt_value) };
}
export async function researchTaxes(subject: TaxSubject, existing: TaxState, emit: Emit, fetcher: typeof fetch = fetch): Promise<TaxState> {
  const report = emptyTaxState(), gaps: string[] = [];
  report.research = { at: new Date().toISOString(), status: "partial", gaps };
  emit("Resolving county and parcel evidence", report);
  let state = normaliseState(subject.state) ?? resolveState([subject.address, subject.city]), county = subject.county ?? "";
  let lat = subject.latitude, lng = subject.longitude;
  if (lat == null || lng == null || !["rooftop", "manual", "geometric_center", "supplied"].includes(subject.precision ?? "")) {
    const located = await geocodeAddress([subject.address, subject.city, state], { requirePrecise: true });
    if (located && ["rooftop", "geometric_center"].includes(located.precision)) { lat = located.lat; lng = located.lng; }
    else { lat = null; lng = null; gaps.push("No precise subject pin; set a verified pin or enter parcel/account IDs with match evidence."); }
  }
  const cachedSource=subject.existingEvidence ? addSource(report, "Existing Hopper location / sourcing evidence (requires re-verification)", "", subject.existingEvidence) : null;
  if(cachedSource) cachedSource.kind="manual";
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    try {
      const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
      url.search = new URLSearchParams({ x:String(lng), y:String(lat), benchmark:"Public_AR_Current", vintage:"Current_Current", format:"json" }).toString();
      const data = await read(url.toString(), true, fetcher);
      const counties = data.result?.geographies?.Counties ?? [], states = data.result?.geographies?.States ?? [];
      if (counties.length === 1) county = text(counties[0].BASENAME || counties[0].NAME).replace(/ County$/i, "");
      if (states.length === 1) state = normaliseState(states[0].STUSAB || states[0].NAME) ?? state;
      addSource(report, "US Census county identification at subject pin", url.toString(), { counties, states });
    } catch { gaps.push("Census county lookup unavailable; county must be verified from parcel evidence."); }
  }
  emit(`County identification: ${county || "unresolved"}, ${state || "state unresolved"}`, report);
  if(cachedSource && Array.isArray(subject.existingEvidence)) for(const event of subject.existingEvidence) {
    const detail=event?.detail??{},roll=detail.appraisalRoll??{},accountId=text(detail.parcelId||roll.propId),cachedCounty=text(detail.county||roll.county);
    const cachedState=state ?? (/TxGIO|Texas|appraisal district/i.test(text(roll.source))?"TX":null);
    if(!accountId||!cachedCounty||!cachedState) continue;
    const key=parcelKey(cachedState,cachedCounty,accountId);if(report.parcels.some(p=>p.key===key))continue;
    report.parcels.push({key,accountId,county:cachedCounty,state:cachedState,address:text(roll.situsAddress)||subject.address,owner:text(roll.owner||detail.owner),legal:"",sourceIds:[cachedSource.id],matchEvidence:["Existing Hopper sourcing evidence identifies this account. Re-verify the account and acquisition boundary against the official parcel record."],review:"pending",reviewNote:"",component:"unknown",assessmentGroup:accountId});
  }
  const subjectResolved = { ...subject, state: state ?? undefined, county: county || undefined };
  if (state === "TX") {
    try {
      if(lat==null||lng==null) throw new Error("A verified point is required for the TxGIO identify service.");
      const url = texasIdentify(lat,lng), data = await read(url, true, fetcher);
      for (const feature of data.results ?? []) {
        const source = addSource(report, "TxGIO county appraisal roll (not a tax bill)", url, feature.attributes);
        const parsed = texasParcel(feature.attributes, subjectResolved, source); if (!parsed) continue;
        source.taxYear = parsed.year;
        const existingIndex=report.parcels.findIndex(p=>p.key===parsed.parcel.key);
        if(existingIndex<0) report.parcels.push(parsed.parcel);
        else report.parcels[existingIndex]={...parsed.parcel,sourceIds:[...new Set([...report.parcels[existingIndex].sourceIds,source.id])]};
        if (parsed.year && parsed.market !== null) report.records.push({ parcelKey: parsed.parcel.key, year: parsed.year, facts: { market:{ value:parsed.market, sourceId:source.id, stage:"reported", reviewed:false } }, jurisdictions:[] });
      }
      if (!report.parcels.length) gaps.push("TxGIO did not identify a dated parcel at the pin. Manually identify every acquisition parcel.");
    } catch(e) { gaps.push(`Texas parcel lookup unavailable: ${e instanceof Error ? e.message : "retry needed"}`); }
    gaps.push("TxGIO publishes market value and parcel identity only. It does not establish taxable value, exemptions, issued bills, payment status or five-year history. Retrieve the county appraisal district and collector records or attach bills.");
  } else if (state === "GA" && county.toLowerCase().replace(/ county$/, "") === "gwinnett") {
    try {
      // The polygon ADDRESS field is only a street number. Resolve the full
      // situs address in the county master before trusting a possibly wrong pin.
      const number=subject.address.match(/^\s*(\d+)\b/)?.[1];
      if(!number) throw new Error('A numbered situs address is required.');
      const street=subject.address.match(/^\s*\d+\s+([a-z]+)/i)?.[1];
      if(!street)throw new Error('A street name is required for an exact address lookup.');
      const lookup=officialQuery(GA_MASTER,{where:`STRNUM=${Number(number)} AND UPPER(STRNAME) LIKE '%${sql(street.toUpperCase())}%'`});
      const master=await read(lookup,true,fetcher);
      const matches=(master.features??[]).filter((f:any)=>normalizedAddress(f.attributes.LOCADDR)===normalizedAddress(subject.address));
      if(!matches.length) throw new Error('No exact county situs-address match. Correct the parcel manually; the pin alone is insufficient.');
      for(const {attributes:a} of matches) {
        const accountId=text(a.RPIN),key=parcelKey('GA','Gwinnett',accountId);
        if(!/^R\d{4}\s*\d{3}[A-Z]?$/i.test(accountId)) {gaps.push('County account format needs manual review.');continue;}
        const source=addSource(report,'Gwinnett county situs-address and owner record (values undated)',lookup,a);
        report.parcels.push({key,accountId,county:'Gwinnett',state:'GA',address:text(a.LOCADDR),owner:text(a.OWNER1),legal:text(a.LEGAL1),sourceIds:[source.id],matchEvidence:['Exact normalized full situs address matches the official county master. Verify acquisition boundaries and any additional parcels.','The map pin is supporting evidence only; it cannot override a conflicting situs address.'],review:'pending',reviewNote:'',component:'unknown',assessmentGroup:accountId});
        const url=`https://www.gwinnetttaxcommissioner.com/PropTaxBill/${encodeURIComponent(accountId)}.pdf`;
        try {
          const response=await fetcher(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
          if(!response.ok) throw new Error(`HTTP ${response.status}`);
          const reader=response.body?.getReader();if(!reader)throw new Error('Empty bill');
          const chunks:Uint8Array[]=[];let size=0;
          while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>4_000_000){await reader.cancel();throw new Error('Bill exceeds 4 MB research limit');}chunks.push(chunk.value);}
          const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
          if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('Official response is not a PDF bill');
          const raw=await gwinnettPdfText(bytes),billSource=addSource(report,'Gwinnett official issued tax bill; verify temporary/appeal notice',url,raw);
          const record=parseGwinnettBill(raw,accountId,subject.address,billSource,key);
          report.records.push(record);report.parcels[report.parcels.length-1].sourceIds.push(billSource.id);
        }catch(e){gaps.push(`Dated official bill unavailable for ${accountId}: ${e instanceof Error?e.message:'retry needed'}.`);}
      }
      gaps.push('Undated figures from the county master are evidence only. Latest issued bill is retrieved separately; earlier years and live payments/balances remain unavailable until supported by dated collector records.');
    } catch(e) { gaps.push(`Gwinnett parcel lookup unavailable: ${e instanceof Error ? e.message : "retry needed"}`); }
    gaps.push("Gwinnett open-data tax master does not identify a tax year for its value fields. Its undated figures are preserved as evidence, not promoted to current taxes. Dated figures come only from separately verified official bills; earlier years and payments may remain unavailable.");
  } else gaps.push(`Automatic dated tax-record extraction is not connected for ${county || "this county"}, ${state || "unknown state"}. Add official records manually or upload bills. No amounts have been inferred.`);
  // Corrected/manual accounts remain in the workspace even when outside the pin.
  if (existing.parcels.length) gaps.push("Previously identified parcels remain in the workspace. A pin lookup is not an exhaustive acquisition boundary search; verify every account, including separate improvement accounts.");
  emit("Parcel evidence available; checking jurisdiction rules", report);
  const rules = state === "TX" ? [
    { url:"https://comptroller.texas.gov/taxes/property-tax/valuing-property.php", label:"Texas Comptroller: appraisal and temporary caps", notes:"Generally appraised at market value as of January 1. Sale is evidence, not an automatic purchase-price reset. Non-homestead circuit-breaker eligibility, ownership timing and exceptions must be verified; the current statutory program expires after 2026. Do not carry a cap into 2027 without new authority. Agricultural/special valuations and exemptions need parcel-specific review." },
    { url:"https://comptroller.texas.gov/taxes/property-tax/truth-in-taxation/calculations.php", label:"Texas Comptroller: rate units", notes:"Published Texas rates are generally dollars per $100 taxable value. Confirm each taxing unit, adopted year, exemptions and collector bill. Do not use a proposed or no-new-revenue rate as an adopted rate." }
  ] : state === "GA" ? [
    { url:"https://dor.georgia.gov/property-tax-real-and-personal-property-faq", label:"Georgia DOR: assessment and millage", notes:"General real-property assessment ratio is 40% of fair market value; a mill is $1 per $1,000 of taxable assessed value. Values are reviewed annually as of January 1; sale does not by itself establish the next assessed value. Verify county timing, appeal restrictions, classifications, exemptions and jurisdiction-specific caps. Residential homestead examples do not establish an IOS exemption." },
    { url:"https://www.gwinnetttaxcommissioner.com/property-tax/billing-information/millage-rates", label:"Gwinnett Tax Commissioner: millage tables", notes:"County, school and city/service district components can differ. Do not use a county-only rate as the entire property rate. Review published table year and parcel district." }
  ] : [];
  for (const rule of rules) {
    if (rule.label.startsWith("Gwinnett") && county.toLowerCase() !== "gwinnett") continue;
    try {
      const html = await read(rule.url, false, fetcher);
      if (/captcha|access denied|verify you are human/i.test(html.slice(0,15000))) throw new Error("Official site requires interactive access.");
      const evidence = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g," ");
      const source = addSource(report,rule.label,rule.url,evidence);
      report.rules.push({ jurisdiction:`${county || "County unverified"}, ${state}`, sourceIds:[source.id], notes:rule.notes, reviewed:false });
    } catch { gaps.push(`Rule source inaccessible: ${rule.url}. Open it manually; no access controls were bypassed.`); }
  }
  gaps.push("Protests, appeals, delinquency, payments, penalties and interest are unknown unless supported by a dated record. Proposed values/rates and forecasts are not issued bills.");
  report.research = { at:new Date().toISOString(), status:"partial", gaps };
  emit("Research finished with source gaps; review partial findings", report);
  return report;
}
