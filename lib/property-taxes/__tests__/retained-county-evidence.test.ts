import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {researchHarrisHistory} from '../harris';
import {researchTravisHistory} from '../travis';
import {parcel} from './fixtures';
// Independently read from the county's published Tax Imposed totals on page 2,
// retained and rendered in docs/tax-evidence-20261023/travis-original-2.png.
const travisExpected=[[2025,157106.14],[2024,152141.43],[2023,153718.49],[2022,157993.84],[2021,156720.89]];
it.runIf(process.env.RETAIN_COUNTY_EVIDENCE==='1')('retains fresh county artifacts and checks independently transcribed references',async()=>{
 const dir='docs/tax-evidence-20261023';mkdirSync(dir,{recursive:true});
 for(const county of ['Harris','Travis']){
  const subject={...parcel,county,accountId:county==='Harris'?'0612170060008':'240449',address:county==='Harris'?'1626 Central Park Drive':'8319 N Lamar Blvd',assessmentGroup:county==='Harris'?'0612170060008':'0237140806'};
  const retain=async(source:any,bytes:Uint8Array,type:string)=>{
   const file=`${county.toLowerCase()}-collector.${type==='application/pdf'?'pdf':'json'}`;
   writeFileSync(`${dir}/${file}`,bytes);
   writeFileSync(`${dir}/${county.toLowerCase()}-collector-manifest.json`,JSON.stringify({file,url:source.url,retrievedAt:source.retrievedAt,account:subject.accountId,sha256:createHash('sha256').update(bytes).digest('hex')},null,2));
  };
  const result=await(county==='Harris'?researchHarrisHistory(subject,fetch,retain):researchTravisHistory(subject,fetch,retain));
  writeFileSync(`${dir}/${county.toLowerCase()}-parsed.json`,JSON.stringify(result,null,2));
  if(county==='Travis')expect(result.records.map(r=>[r.year,r.facts.levied?.value])).toEqual(travisExpected);
  else expect(result.records.map(r=>[r.year,r.facts.levied?.value])).toEqual([[2025,27462.14],[2024,26947.83],[2023,25333.8],[2022,3450.45],[2021,2505.29]]);
 }
},120000);
