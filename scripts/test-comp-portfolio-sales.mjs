import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {load,saleCase,json} from './portfolio-sale-case.mjs';
const result=await saleCase(),comps=result.comps;
assert.equal(result.sourceRows,7);assert.equal(comps.length,4);
assert.deepEqual(comps.map(c=>[c.sourceRow,c.salePrice,c.buildingSf,c.acres]),[[1,38010000,183008,26.5],[2,27000000,187793,17.45],[6,33000000,165601,14.7],[7,53500000,15080,117.39]]);
const expected=[
 [['15835-15847 Kimberlee St',null,null,1],['2840 Appelt Dr',null,null,1],['6770 McHard Rd',null,null,1],['28155 Hwy 90 W',null,null,1]],
 [['12400 Taylor Rd',null,7757463,5],['15800 Export Plaza',null,12794776,4],['2015 Pasket Ln',null,6447761,3]],
 [['6410 Langfield','Bldg. B',null,6],['6410 Langfield','Bldg. C',null,6],['6410 Langfield','Bldg. F',null,6],['2437 Peyton Rd',null,null,6],['2442 Greens Rd',null,null,6]],
 [['7226 N Loop',null,null,7],['10604-11643 Wallisville Rd',null,null,7],['3611-5451 Oates Rd',null,null,7],['10310 Beaumont Hwy',null,null,7]],
];
assert.deepEqual(comps.map(c=>c.portfolio.properties.map(p=>[p.address,p.buildingIdentifier,p.allocatedPrice,p.sourceRow])),expected);
assert.deepEqual(comps.map(c=>c.portfolio.reportedPropertyCount),[6,3,5,11]);
assert.equal(comps[1].portfolio.properties.reduce((s,p)=>s+p.allocatedPrice,0),27000000);
assert.deepEqual(comps.map(c=>c.portfolio.reportedCountKind),['properties','assets','buildings','sites']);
assert.ok(comps[0].portfolio.warnings.some(w=>w.includes('6 properties')));
assert.ok(comps[3].portfolio.warnings.some(w=>w.includes('11 sites')));
assert.equal(comps[3].acres,117.39,'footer excluded');
assert.ok(comps[3].portfolio.properties[1].originalAddress.includes('10604-\n11643'),'original wrapped range retained');
for(const [index,c] of comps.entries()){
 assert.equal(c.sourcePage,1);assert.equal(c.datePrecision,'month');assert.equal(c.latitude,null);
 for(const p of c.portfolio.properties){assert.equal(p.sourcePage,1);assert.ok(p.originalAddress);if(index!==1){assert.equal(p.buildingSf,null);assert.equal(p.acres,null);assert.equal(p.capRate,null);}}
}
const match=load('lib/comps/match.ts'),market=load('lib/comps/market.ts'),uw=load('lib/comps/underwriting.ts');
const port=load('lib/comps/portfolios.ts');
assert.equal(port.constituentAddresses('100-120 Main St, 400 Other Rd').length,2);
assert.equal(port.constituentAddresses('100–120 Main St')[0].originalAddress,'100–120 Main St');
assert.ok(port.groupPortfolioSales([{compType:'sale',address:'Incomplete Portfolio',projectName:'Incomplete Portfolio',notes:'Source reports a portfolio but no address list.',salePrice:1000000}])[0].portfolio,'unresolved portfolio never becomes a single-property price observation');
const validation=load('lib/comps/intake-validation.ts');
assert.match(validation.compIssue(comps[0]),/Review the constituent/);
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table comps(id uuid primary key default gen_random_uuid(),address text not null,project_name text,comp_type text,closed_on date,date_precision text,sale_price numeric,buyer text,seller text,building_sf numeric,lot_sf numeric,coverage_pct numeric,cap_rate numeric,city text,state text,market text,asset_class text,notes text,source text,source_ref text,created_by text,status text,latitude numeric,longitude numeric,geocode_precision text,created_at timestamptz default now());alter table comps enable row level security;grant all on comps to service_role;`);
await db.exec(fs.readFileSync('supabase/migrations/20261027202826_portfolio_sale_properties.sql','utf8'));
// Existing component observations are retained and linked, never counted twice.
for(const p of comps[1].portfolio.properties)await db.query(`insert into comps(address,comp_type,closed_on,sale_price,buyer,seller,status,building_sf,lot_sf) values($1,'sale','2026-03-01',$2,'Transport','Apricus','confirmed',$3,$4)`,[p.address,p.allocatedPrice,p.buildingSf,Math.round(p.acres*43560)]);
let calls=[],payloads=[];
const saver=load('lib/comps/save-portfolio.ts',{'../locate-site':{locateMany:async(rows)=>{calls.push(...rows.map(r=>r.address));return rows.map((r,i)=>({found:true,latitude:29.7+i*.001,longitude:-95.4,precision:'rooftop'}));}}});
const repository={rpc:async(name,args)=>{payloads.push(args);try{const data=await db.query('select save_comp_sale_portfolio($1::jsonb,$2::jsonb) as value',[JSON.stringify(args.transaction_data),JSON.stringify(args.property_data)]);return{data:data.rows[0].value,error:null};}catch(e){return{data:null,error:{message:e.message}};}}};
let saved=await saver.savePortfolioBatch(repository,comps,'test@example.com','import','fixture.pdf');
assert.equal(saved.saved,0);assert.equal(payloads.length,0,'review acknowledgement required on server');
const reviewed=comps.map((c,i)=>({...c,_key:String(i),portfolio:{...c.portfolio,reviewAcknowledged:true}}));
await db.exec('set role service_role');
saved=await saver.savePortfolioBatch(repository,reviewed,'test@example.com','import','fixture.pdf');
await db.exec('reset role');
assert.equal(saved.saved,4,JSON.stringify(saved));assert.equal(saved.failed.length,0);
assert.equal(calls.length,13);assert.ok(calls.every(a=>!a.includes('Portfolio')&&!/\d+-\d+/.test(a)),'no portfolio list or range geocoded as one site');
const parents=(await db.query('select * from comps where is_portfolio order by sale_price')).rows;
const properties=(await db.query('select * from comp_sale_properties')).rows;
assert.equal(parents.length,4);assert.equal(properties.length,16);assert.equal(properties.filter(p=>p.allocated_price!=null).length,3);
assert.equal((await db.query('select * from comps where portfolio_transaction_id is not null')).rows.length,3);
assert.equal(parents.reduce((sum,p)=>sum+Number(p.sale_price),0),151510000,'consideration counted once');
assert.equal(properties.filter(p=>p.latitude==null).length,3,'three address ranges remain explicitly unlocated');
assert.ok(parents.every(p=>p.latitude==null&&p.longitude==null));
for(const p of parents){assert.equal(match.unitValue(p,'land'),null);assert.equal(market.compRate(p,'ios'),null);}
const linked=(await db.query('select * from comps where portfolio_transaction_id is not null')).rows;
assert.ok(linked.every(c=>match.unitValue(c,'land')===null&&market.compRate(c,'ios')===null));
const subject={lat:29.7,lng:-95.4,buildingSf:50000,lotSf:435600,coveragePct:.1,assetClass:'ios',market:'Houston',submarket:null};
assert.equal(match.scoreComps([...parents,...linked],subject,'sale').length,0);
assert.equal(uw.compUnderwriting([...parents,...linked],subject).sale.perAcre.count,0);
const pins=port.portfolioMapRows([...parents,...linked],properties);
assert.equal(pins.length,16);assert.equal(new Set(pins.map(p=>p.transaction_id)).size,4);
assert.equal(pins.filter(p=>p.sale_price!=null).length,3);
assert.ok(pins.filter(p=>p.sale_price==null).every(p=>p.building_sf==null&&p.lot_sf==null&&p.cap_rate==null));
saved=await saver.savePortfolioBatch(repository,reviewed,'test@example.com','import','fixture.pdf');
assert.equal(saved.duplicates,4,JSON.stringify(saved));assert.equal(saved.saved,0);
const conflicting=structuredClone(reviewed[1]);conflicting.portfolio.properties[0].allocatedPrice+=1;
const bad=await saver.savePortfolioBatch(repository,[conflicting],'test@example.com','import','fixture.pdf');
assert.equal(bad.failed.length,1);assert.match(bad.failed[0].reason,/preserved/);
assert.equal((await db.query('select count(*)::int as n from comp_sale_properties')).rows[0].n,16);
// A failure late in the RPC rolls back the parent AND earlier properties.
const broken=structuredClone(payloads[0]);broken.transaction_data.address='Atomic failure portfolio';broken.transaction_data.project_name='Atomic failure portfolio';broken.property_data.at(-1).allocated_price=-1;
const rollback=await repository.rpc('save_comp_sale_portfolio',broken);assert.ok(rollback.error);
assert.equal((await db.query("select * from comps where address='Atomic failure portfolio'")).rows.length,0);
await db.exec('set role anon');await assert.rejects(db.query('select * from comp_sale_properties'),/permission denied/);await assert.rejects(db.query("select save_comp_sale_portfolio('{}','[]')"),/permission denied/);await db.exec('reset role');
await db.exec('set role authenticated');await assert.rejects(db.query('select * from comp_sale_properties'),/permission denied/);await db.exec('reset role');
fs.mkdirSync('.scratch/starpoint-sales',{recursive:true});fs.writeFileSync('.scratch/starpoint-sales/verified.json',JSON.stringify({sourceRows:7,transactions:4,propertyEntries:16,sourceReportedAllocations:3,totalConsideration:151510000,unexpandedRanges:3,checks:'extraction, source rows, linked atomic saves, reload, exact pins, allocations, idempotency, conflicts, rollback, statistics, underwriting, access'},null,2));
await db.close();console.log('Portfolio sales: 7 source rows → 4 transactions / 16 constituent entries; complete extraction, atomic linked saves, reload, map membership, duplicate/conflict handling, rollback, underwriting exclusion and access checks passed.');
