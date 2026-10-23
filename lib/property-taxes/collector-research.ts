import {CollectorSession} from './collector-http';
import {parseGwinnettBill,gwinnettPdfText} from './gwinnett';
import {researchHarrisHistory} from './harris';
import {researchTravisHistory} from './travis';
import type {TaxParcel,TaxSource,TaxRecord,TaxResearchAttempt,RetainTaxEvidence} from './types';

export async function researchAccount(parcel:TaxParcel,fetcher:typeof fetch=fetch,retain?:RetainTaxEvidence):Promise<{sources:TaxSource[];records:TaxRecord[];attempt:TaxResearchAttempt}>{
 const county=parcel.county.toLowerCase().replace(/\s+county$/,'').trim();
 const attempt:TaxResearchAttempt={parcelKey:parcel.key,status:'unsupported',message:`Historical collector retrieval is not connected for ${parcel.county}, ${parcel.state}. No historical bills were fetched for this account.`};
 if(parcel.state==='TX'&&['harris','travis'].includes(county)){
  attempt.sourceUrl=county==='harris'?'https://www.hctax.net/Property/ViewStatementReceipts':'https://tax-office.traviscountytx.gov/properties/taxes/account-search';
  try{const result=await(county==='harris'?researchHarrisHistory(parcel,fetcher,retain):researchTravisHistory(parcel,fetcher,retain));return {sources:[result.source],records:result.records,attempt:{...attempt,status:'retrieved',message:`Official bill history retrieved for ${result.records.length} published years. Verify collector scope and parcel coverage.`}};}
  catch(e){attempt.status='failed';attempt.message=e instanceof Error?e.message:'Official collector retrieval failed. Retry.';return {sources:[],records:[],attempt};}
 }
 if(parcel.state==='GA'&&county==='gwinnett'){
  attempt.sourceUrl='https://www.gwinnetttaxcommissioner.com/pay';
  if(!/^R\d{4}\s*\d{3}[A-Z]?$/i.test(parcel.accountId))return {sources:[],records:[],attempt:{...attempt,status:'failed',message:'Gwinnett account format needs review before requesting a bill.'}};
  let sources:TaxSource[]=[],records:TaxRecord[]=[];
  try{
   const url=`https://www.gwinnetttaxcommissioner.com/PropTaxBill/${encodeURIComponent(parcel.accountId)}.pdf`;
   const response=await new CollectorSession(fetcher).read(url,{binary:true});
   if(new TextDecoder().decode(response.bytes.slice(0,5))!=='%PDF-')throw Error('Official response is not a PDF bill.');
   const original=response.bytes.slice();
   const raw=await gwinnettPdfText(response.bytes),source:TaxSource={id:crypto.randomUUID(),label:'Gwinnett official issued tax bill; verify temporary/appeal notice',url,retrievedAt:new Date().toISOString(),taxYear:null,kind:'official',evidence:raw.slice(0,60000)};
   const row=parseGwinnettBill(raw,parcel.accountId,parcel.address,source,parcel.key);
   if(retain)await retain(source,original,'application/pdf');
   sources=[source];records=[row];
  }catch(e){attempt.status='failed';attempt.message=`Latest issued bill unavailable: ${e instanceof Error?e.message:'retry needed'}`;return {sources,records,attempt};}
  // Inspect the ordinary public entry point. Never guess protected resource URLs,
  // transfer a browser CAPTCHA token, or bypass its interactive access requirement.
  try{await new CollectorSession(fetcher).read(attempt.sourceUrl);attempt.status='unsupported';attempt.message='Latest issued bill retrieved. Older bills require the official interactive account workflow; automated historical extraction is not connected.';}
  catch(e){attempt.status='blocked';attempt.message=`Latest issued bill retrieved. Older bills were not retrieved: ${e instanceof Error?e.message:'official portal unavailable'}`;}
  return {sources,records,attempt};
 }
 return {sources:[],records:[],attempt};
}
