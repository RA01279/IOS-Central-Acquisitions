import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('enqueues future properties and assets, leases one worker, and preserves revision evidence',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table properties(id uuid primary key,address text,city text,latitude numeric,longitude numeric,geocode_precision text);create table assets(id uuid primary key,address text,city text,state text,latitude numeric,longitude numeric,geocode_precision text,status text);create table deals(id uuid primary key,property_id uuid,stage text);`);
 await db.exec(readFileSync('supabase/migrations/20261026150538_property_tax_ingestion.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261027130712_property_tax_worker_recovery.sql','utf8'));
 const id='00000000-0000-4000-8000-000000000001';await db.query('insert into properties(id,address) values($1,$2)',[id,'Synthetic new property']);
 const jobs=await db.query<{status:string}>('select status from property_tax_jobs');expect(jobs.rows[0].status).toBe('queued');
 await db.query('insert into assets(id,address,status) values($1,$2,$3)',[id,'Synthetic asset','owned']);expect((await db.query('select * from property_tax_jobs where subject_kind=\'asset\'')).rows).toHaveLength(1);
 const claim=await db.query<{lease:string}>(`select * from claim_property_tax_job()`);expect(claim.rows).toHaveLength(1);expect((await db.query('select * from claim_property_tax_job()')).rows).toHaveLength(0);
 const state={version:1,sources:[{id:'original',evidence:'original county capture'}]};await db.query('select save_property_tax_subject($1,$2,$3,$4)',['property',id,0,JSON.stringify(state)]);
 await expect(db.query('select save_property_tax_subject($1,$2,$3,$4)',['property',id,0,JSON.stringify(state)])).rejects.toThrow('changed');
 await expect(db.query('select save_property_tax_subject($1,$2,$3,$4)',['property',id,1,JSON.stringify({version:1,sources:[]})])).rejects.toThrow('retained');
 await db.query('update properties set address=$1 where id=$2',['Changed subject',id]);expect((await db.query<{status:string,lease:string}>("select status,lease from property_tax_jobs where subject_kind='property'")).rows[0]).toEqual({status:'queued',lease:null});
 await db.exec("update property_tax_jobs set status='processing',attempts=3,locked_until=now()-interval '1 minute'");await db.query('select * from claim_property_tax_job()');expect((await db.query("select * from property_tax_jobs where status='failed'")).rows).toHaveLength(2);
 }finally{await db.close();}
},60000); // PGlite startup is slow under a full parallel run.
