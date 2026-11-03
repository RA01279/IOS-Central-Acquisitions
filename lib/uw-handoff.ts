export type Field = { key: string; label: string; type?: 'number' | 'date' | 'url' | 'textarea'; options?: readonly string[]; hint?: string };
export const RENT_UNITS = ['$/rentable yard acre/month', '$/rentable yard acre/year', '$/building SF/month', '$/building SF/year', '$/property/month', '$/property/year'] as const;
export const COVERAGE = ['Building', 'Yard', 'Building and yard'] as const;
export const OVERVIEW: Field[] = [
  { key:'property', label:'Property name' }, { key:'address', label:'Address' }, { key:'folder', label:'Source-folder link', type:'url' },
  { key:'price', label:'Purchase price ($)', type:'number' }, { key:'closing', label:'Assumed closing date', type:'date' },
  { key:'grossAcres', label:'Gross acres', type:'number' }, { key:'yardAcres', label:'Rentable yard acres', type:'number' }, { key:'buildingSf', label:'Building SF', type:'number' },
  { key:'tenant', label:'Tenant' }, { key:'currentRent', label:'Current base rent ($)', type:'number' }, { key:'currentUnits', label:'Current rent units', options:RENT_UNITS }, { key:'currentCoverage', label:'Current rent includes', options:COVERAGE },
  { key:'expiration', label:'Lease expiration', type:'date' }, { key:'recovery', label:'Recovery structure', hint:'Current lease: NNN, gross, modified gross, or describe.' }, { key:'plan', label:'Business plan and underwriting instructions', type:'textarea', hint:'State what to model, including scenarios or leasing events.' },
];
export const MARKET: Field[] = [
  { key:'marketRent', label:'Market rent ($)', type:'number' }, { key:'marketUnits', label:'Market rent units', options:RENT_UNITS }, { key:'marketCoverage', label:'Market rent includes', options:COVERAGE }, { key:'effective', label:'Market rent effective date', type:'date' },
  { key:'growth', label:'Annual market rent growth (%)', type:'number' }, { key:'escalations', label:'Contractual lease escalations', hint:'Rate or dollar steps, frequency, and first step date. Separate current and future leases if needed.' },
  { key:'renewalProbability', label:'Renewal probability (%)', type:'number' }, { key:'downtime', label:'Downtime if tenant leaves (months)', type:'number' },
  { key:'recovery', label:'Expense recovery structure', hint:'NNN, gross, modified gross, or describe.' }, { key:'landlord', label:'Landlord responsibilities', type:'textarea', hint:'Tax, insurance, CAM, roof, structure, yard and drainage as applicable. Describe any new/renewal differences.' },
];
export const LEASE_FIELDS: Field[] = [
  { key:'term', label:'Lease term (months)', type:'number' }, { key:'freeRent', label:'Free rent (months)', type:'number' }, { key:'freeTiming', label:'Free rent timing / coverage', hint:'When abatement begins; base rent only or recoveries too.' },
  { key:'ti', label:'TI amount', type:'number' }, { key:'tiBasis', label:'TI units', options:['$ total', '$/building SF', '$/rentable yard acre'] }, { key:'tiTiming', label:'TI payment timing', hint:'For example: 100% at commencement or 50% at signing / 50% at occupancy.' },
  { key:'lc', label:'LC amount / rate', type:'number' }, { key:'lcBasis', label:'LC basis', options:['$ total', '% of total base rent over lease term', '% of collected base rent', 'Other (describe in notes)'] }, { key:'lcTiming', label:'LC payment timing', hint:'State payment events or dates and any split. Clarify commissionable rent in notes if needed.' },
];
export const CAPEX_FIELDS: Field[] = [
  { key:'description', label:'Project description' }, { key:'amount', label:'Project amount ($ total)', type:'number' },
  { key:'timing', label:'Spending timing', options:['At closing', 'Specific month', 'Spread across period'] },
  { key:'month', label:'Spending month', type:'date' }, { key:'start', label:'Start month', type:'date' }, { key:'end', label:'End month', type:'date' },
  { key:'responsibility', label:'Paid by', options:['Landlord', 'Tenant', 'Shared (describe in notes)'] },
  { key:'reimbursement', label:'Reimbursement / recovery', hint:'Enter None if confirmed; otherwise describe amount and timing.' },
  { key:'dependency', label:'Completion required', options:['Before leasing', 'Before occupancy', 'No leasing or occupancy dependency'] },
  { key:'completion', label:'Required completion date', type:'date' }, { key:'notes', label:'Project notes (optional)', type:'textarea' },
];
export type Values = Record<string,string>;
export type Handoff = { schema:1; overview:Values; market:Values; newLease:Values; renewal:Values; capex:Values[]; capexPlan:string; notes:string };
const empty = (fields:Field[]):Values => Object.fromEntries(fields.map(f=>[f.key,'']));
export function blankHandoff():Handoff { return { schema:1, overview:empty(OVERVIEW),market:empty(MARKET),newLease:empty(LEASE_FIELDS),renewal:empty(LEASE_FIELDS),capex:[],capexPlan:'',notes:'' }; }
export function seedHandoff(deal:any):Handoff {
  const h=blankHandoff(), p=deal?.properties ?? {};
  const val=(v:unknown)=>v == null ? '' : String(v);
  Object.assign(h.overview,{property:val(p.address),address:[p.address,p.city,p.market && p.market!==p.city ? p.market : ''].filter(Boolean).join(', '),price:val(deal?.contract_price),closing:val(deal?.closing_on),grossAcres:p.lot_sf == null ? '' : String(Math.round(Number(p.lot_sf)/43560*10000)/10000),buildingSf:val(p.building_sf)});
  // This tool intentionally does not import model assumptions or infer rentable yard area.
  return h;
}
export function capexFields(c:Values):Field[] { return CAPEX_FIELDS.filter(f=>f.key==='month' ? c.timing==='Specific month' : ['start','end'].includes(f.key) ? c.timing==='Spread across period' : f.key==='completion' ? ['Before leasing','Before occupancy'].includes(c.dependency) : true); }
export function validateHandoff(h:unknown):string|null {
  if(!h || typeof h!=='object')return 'Invalid handoff.';
  const x=h as Handoff;
  if(x.schema!==1 || typeof x.notes!=='string' || x.notes.length>12000 || !['','None','Projects'].includes(x.capexPlan) || !Array.isArray(x.capex) || x.capex.length>50)return 'Invalid handoff.';
  const groups:[Values,Field[]][]=[[x.overview,OVERVIEW],[x.market,MARKET],[x.newLease,LEASE_FIELDS],[x.renewal,LEASE_FIELDS],...x.capex.map(c=>[c,CAPEX_FIELDS] as [Values,Field[]])];
  for(const [v,fields] of groups){
    if(!v || typeof v!=='object' || Array.isArray(v))return 'Invalid fields.';
    for(const f of fields){const s=v[f.key];if(s===undefined && (fields===CAPEX_FIELDS || (fields===OVERVIEW && f.key==='recovery')))continue;if(typeof s!=='string' || s.length>6000)return `Invalid ${f.label}.`;if(!s)continue;
      if(f.options && !f.options.includes(s))return `Invalid ${f.label}.`;
      if(f.type==='number' && (!/^\d+(\.\d+)?$/.test(s) || !Number.isFinite(Number(s))))return `${f.label} must be a non-negative number or blank.`;
      if(f.type==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10)!==s))return `Invalid ${f.label}.`;
      if(f.type==='url'){try{if(!['https:','http:'].includes(new URL(s).protocol))return 'Use an http or https folder link.';}catch{return 'Use a full folder URL.';}}
    }
  }
  if(x.market.renewalProbability && Number(x.market.renewalProbability)>100)return 'Renewal probability cannot exceed 100%.';
  if(x.capexPlan!=='Projects' && x.capex.length)return 'Choose Projects for a capital plan with projects.';
  for(const c of x.capex)if(c.timing==='Spread across period' && c.start && c.end && c.start.slice(0,7)>c.end.slice(0,7))return 'Capex end month must be on or after its start month.';
  return null;
}
export function displayValue(f:Field,v:string|undefined):string {
  if(v===undefined || v==='')return 'Not provided';
  if(f.type==='date')return new Date(v+'T00:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
  if(f.type==='number')return Number(v).toLocaleString('en-US',{maximumFractionDigits:6});
  return v;
}
export function capexSchedule(c:Values):string {
  if(!c.timing)return 'Spending timing not provided';
  if(c.timing==='At closing')return 'At closing (month 0)';
  const month=(v:string)=>v ? new Date(v+'T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'}) : 'Not provided';
  if(c.timing==='Specific month')return `In ${month(c.month)}`;
  let result=`Spread evenly from ${month(c.start)} through ${month(c.end)} (inclusive)`;
  if(c.start && c.end && c.amount!==''){const a=c.start.split('-').map(Number),b=c.end.split('-').map(Number),n=(b[0]-a[0])*12+b[1]-a[1]+1;if(n>0)result+=`; ${n} months, approximately $${(Number(c.amount)/n).toLocaleString('en-US',{maximumFractionDigits:2})}/month; total $${Number(c.amount).toLocaleString('en-US')}`;}
  return result;
}
export function missingInputs(h:Handoff):string[] {
  const result:string[]=[];
  for(const [name,values,fields] of [['Deal',h.overview,OVERVIEW],['Market',h.market,MARKET],['New lease',h.newLease,LEASE_FIELDS],['Renewal',h.renewal,LEASE_FIELDS]] as const){for(const f of fields)if(!values[f.key])result.push(`${name}: ${f.label}`);}
  if(!h.capexPlan)result.push('Capex plan');
  if(h.capexPlan==='Projects' && !h.capex.length)result.push('Capex projects');
  h.capex.forEach((c,i)=>capexFields(c).filter(f=>f.key!=='notes' && !c[f.key]).forEach(f=>result.push(`Project ${i+1}: ${f.label}`)));
  return result;
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function handoffHtml(h:Handoff,savedAt:string):string {
  const rows=(fields:Field[],v:Values)=>fields.map(f=>`<tr><th>${esc(f.label)}</th><td class="${v[f.key] ? '' : 'missing'}">${esc(displayValue(f,v[f.key]))}</td></tr>`).join('');
  const missing=missingInputs(h);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(h.overview.property || 'IOS UW Handoff')}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#364049;max-width:900px;margin:40px auto;padding:0 24px}h1,h2,h3{color:#0A2540}h1{margin-bottom:4px}h2{border-top:4px solid #4E9FD6;padding-top:12px;margin-top:32px}table{width:100%;border-collapse:collapse;margin:12px 0 24px}th,td{border-bottom:1px solid #DDE4EB;padding:7px 10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{width:38%;font-weight:600}.missing{color:#6B7A88;font-style:italic}.eyebrow{color:#0E5AA7;font-size:12px;font-weight:bold;letter-spacing:.14em}details{background:#F6F8FA;padding:12px}a{color:#0E5AA7}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}h2,h3{break-after:avoid}details{display:none}}</style><body><div class="eyebrow">HOPPER / IOS ACQUISITIONS</div><h1>${esc(h.overview.property || 'IOS Underwriting Handoff')}</h1><p>Underwriting instructions · Saved ${esc(new Date(savedAt).toISOString())}</p><p>Use the values below. “Not provided” means missing; 0 is a confirmed zero. All dollar amounts are USD. Do not substitute assumptions for missing inputs.</p><h2>Deal Overview</h2><table>${rows(OVERVIEW,h.overview)}</table>${h.overview.folder ? `<p>Source folder: <a href="${esc(h.overview.folder)}">${esc(h.overview.folder)}</a></p>` : ''}<h3>Capex Projects</h3><p>${h.capexPlan==='None' ? 'Confirmed: no capex planned ($0).' : h.capexPlan==='Projects' ? 'Project costs are separate from TI, LC and recurring operating expenses. Spread schedules use equal monthly installments; reconcile rounding to the project total.' : 'Capex plan: Not provided.'}</p>${h.capex.map((c,i)=>`<h3>Project ${i+1}: ${esc(c.description || 'Description not provided')}</h3><p>${esc(capexSchedule(c))}</p><table>${rows(capexFields(c).filter(f=>!['month','start','end'].includes(f.key)),c)}</table>`).join('')}<p>Coordinate make-ready work with leasing downtime. Count each cost and each period of downtime once.</p><h2>Market Leasing Assumptions</h2><table>${rows(MARKET,h.market)}</table><h3>New Lease</h3><table>${rows(LEASE_FIELDS,h.newLease)}</table><h3>Renewal</h3><table>${rows(LEASE_FIELDS,h.renewal)}</table>${h.notes ? `<h3>Notes</h3><p style="white-space:pre-wrap">${esc(h.notes)}</p>` : ''}${missing.length ? `<details open><summary>${missing.length} missing inputs</summary><p>${missing.map(esc).join(' · ')}</p></details>` : ''}</body></html>`;
}

export function handoffFilename(title:string):string { return (title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().slice(0,120)||'Deal')+'_UW handoff.pdf'; }
