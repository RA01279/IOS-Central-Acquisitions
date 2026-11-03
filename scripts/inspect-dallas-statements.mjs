import {mkdirSync,writeFileSync} from 'node:fs';
const dir='docs/tax-system-audit-20261026/dallas';mkdirSync(dir,{recursive:true});
const base='https://www.dallasact.com/act_webdev/dallas/';
let cookies='';
async function read(url,name){const r=await fetch(url,{headers:{Cookie:cookies},signal:AbortSignal.timeout(25000)});cookies=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')||cookies;const b=Buffer.from(await r.arrayBuffer());writeFileSync(`${dir}/${name}`,b);console.log(JSON.stringify({url,status:r.status,type:r.headers.get('content-type'),bytes:b.length,head:b.toString().slice(0,100)}));return b.toString();}
await read(base+'index.jsp','entry.html');
await read(base+'showdetail2.jsp?can=26095600010010000&ownerno=0','account.html');
const html=await read(base+'requests/summarystatement/summary_generate.jsp?can=26095600010010000&ownerno=0','summary.html');
await read(base+'requests/currentstatement/statement_prepare.jsp?can=26095600010010000&ownerno=0','current-prepare.html');
await read(base+'requests/receipt/composite_year.jsp?can=26095600010010000&ownerno=0','receipt-years.html');
const target=html.match(/CONTENT="\d+;URL=([^"]+)/i)?.[1];
if(target){await new Promise(r=>setTimeout(r,2500));const download=await read(new URL(target,base+'requests/summarystatement/summary_generate.jsp').href,'summary-download.bin');const pdf=download.match(/href="([^"]+\.pdf)"/i)?.[1];if(pdf)await read(new URL(pdf,base).href,'summary.pdf');}
const current=await read(base+'requests/currentstatement/statement_download.jsp','current-download.html');
const pdf=current.match(/href="([^"]+\.pdf)"/i)?.[1];if(pdf)await read(new URL(pdf,base).href,'current.pdf');
const receiptYear=process.argv[2]??'2025';
const r=await fetch(base+'requests/receipt/composite_prepare.jsp',{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({can:'26095600010010000',year:receiptYear}),signal:AbortSignal.timeout(25000)});
const receipt=await r.text();writeFileSync(`${dir}/receipt-prepare.html`,receipt);console.log(receipt.match(/CONTENT="[^"]+/gi));
await new Promise(r=>setTimeout(r,2500));
const download=await read(base+'requests/receipt/'+(receipt.match(/CONTENT="\d+;URL=([^"]+)/i)?.[1]??'composite_download.jsp'),'receipt-download.html');
const rp=download.match(/href="([^"]+\.pdf)"/i)?.[1];if(rp)await read(new URL(rp,base).href,`receipt-${receiptYear}.pdf`);
