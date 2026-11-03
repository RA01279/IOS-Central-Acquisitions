import {runTaxJob} from './worker';
/** At most three sequential subjects; each research run has its own 90s limit. */
export async function runTaxBatch(db:any){const started=Date.now(),results=[];while(results.length<3&&Date.now()-started<180000){const r=await runTaxJob(db);if(!r)break;results.push(r);}return results;}
