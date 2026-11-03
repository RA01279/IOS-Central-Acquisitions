// Creates and removes only its own clearly labeled test handoff. Never changes a deal.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {seedHandoff} from '../lib/uw-handoff.ts';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const base=process.argv[2] || 'http://localhost:4319';
const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:'randerson@dalfen.com'});
if(linkError)throw linkError;
const jar=new Map();
const client=createServerClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{cookies:{get:n=>jar.get(n),set:(n,v)=>jar.set(n,v),remove:n=>jar.delete(n)}});
const {error:loginError}=await client.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'});if(loginError)throw loginError;
const cookie=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
const id=randomUUID();const checks=[];
try{
  const {data:deal,error}=await admin.from('deals').select('id,contract_price,closing_on,properties(*)').eq('id','237aa70f-fa78-486a-8472-1d453a40ad18').single();if(error)throw error;
  const h=seedHandoff(deal);assert.equal(h.overview.price,'3475000');assert.equal(h.overview.buildingSf,'28800');assert.equal(h.overview.yardAcres,'');assert.equal(h.market.marketRent,'');checks.push('Tomball live deal prefill, missing yard area, no model assumptions');
  h.overview.property='TEST ONLY - Tomball handoff verification';Object.assign(h.overview,{tenant:'USA Compression',currentRent:'20736',currentUnits:'$/property/month',currentCoverage:'Building and yard',expiration:'2029-03-31',plan:'Verification fixture; not sponsor instructions.'});Object.assign(h.market,{marketRent:'0.95',marketUnits:'$/building SF/month',marketCoverage:'Building and yard',growth:'2.5',escalations:'3.5% per lease anniversary'});
  h.capexPlan='Projects';h.capex=[{description:'Gate test',amount:'12000',timing:'At closing'},{description:'Drainage test',amount:'90000',timing:'Specific month',month:'2027-02-01'},{description:'Surface test',amount:'60000',timing:'Spread across period',start:'2027-03-01',end:'2027-05-01',dependency:'Before occupancy',completion:'2027-05-31'}];
  Object.assign(h.newLease,{ti:'75000',tiBasis:'$ total',tiTiming:'50% signing / 50% occupancy',lc:'7',lcBasis:'% of total base rent over lease term',lcTiming:'At commencement'});Object.assign(h.renewal,{ti:'0',tiBasis:'$ total',tiTiming:'No payment',lc:'0',lcBasis:'$ total',lcTiming:'No payment'});
  async function save(expected,payload=h,headers={Cookie:cookie()}){return fetch(base+'/api/uw-handoffs',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({id,dealId:deal.id,expected,payload})});}
  let r=await save(0);assert.equal(r.status,200,await r.text());checks.push('Authenticated API save');
  const {data:row,error:readError}=await admin.from('uw_handoffs').select('*').eq('id',id).single();if(readError)throw readError;assert.deepEqual(row.payload,h);checks.push('Database round-trip preserves every value, unit, zero, project and timing');
  r=await fetch(base+`/uw-handoffs/${id}`,{headers:{Cookie:cookie()}});assert.equal(r.status,200);assert.match(await r.text(),/TEST ONLY - Tomball/);checks.push('Saved handoff reload');
  r=await fetch(base+`/api/uw-handoffs/${id}/export`,{headers:{Cookie:cookie()}});assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment/);const html=await r.text();
  for(const v of ['20,736','$/property/month','$/building SF/month','Building and yard','At closing (month 0)','In Feb 2027','3 months, approximately $20,000/month; total $60,000','Before occupancy','75,000','50% signing / 50% occupancy','At commencement','Not provided'])assert.ok(html.includes(v),`Missing output: ${v}`);
  for(const v of ['Jodeco','19902','Hufsmith','624,000','64,884'])assert.ok(!html.includes(v),`Unrelated info: ${v}`);checks.push('Shareable export, rent units/coverage, all capex schedules, separate TI/LC, missing values and unrelated-property exclusion');
  r=await save(1);assert.equal(r.status,200);r=await save(1);assert.equal(r.status,409);checks.push('Edits save; stale revision cannot overwrite newer values');
  r=await save(2,h,{});assert.equal(r.status,401);r=await fetch(base+`/api/uw-handoffs/${id}/export`);assert.equal(r.status,401);checks.push('Unauthenticated save and export rejected');
  const invalid=structuredClone(h);invalid.capex[0].amount='-1';r=await save(2,invalid);assert.equal(r.status,400);checks.push('Invalid cost rejected without overwriting saved handoff');
  r=await fetch(base+`/uw-handoffs/new?deal=${deal.id}`,{headers:{Cookie:cookie()}});assert.equal(r.status,200);assert.match(await r.text(),/3475000/);r=await fetch(base+'/uw-handoffs/new',{headers:{Cookie:cookie()}});assert.equal(r.status,200);checks.push('Deal-linked and standalone creation pages render');
  console.log(JSON.stringify({base,status:'PASS',checks,analystTrial:'Pending'},null,2));
}finally{const {error}=await admin.from('uw_handoffs').delete().eq('id',id);if(error)throw error;await client.auth.signOut({scope:'local'});}
