import {mkdirSync,writeFileSync} from 'node:fs';
const dir='docs/tax-system-audit-20261026/portals';mkdirSync(dir,{recursive:true});
const inputs=[['montgomery-entry','https://actweb.acttax.com/montgomery/montgomery/index.jsp']];
for(const [name,url] of inputs){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)}),b=Buffer.from(await r.arrayBuffer());writeFileSync(`${dir}/${name}.html`,b);writeFileSync(`${dir}/${name}.json`,JSON.stringify({url,retrievedAt:new Date().toISOString(),status:r.status,headers:Object.fromEntries([...r.headers].filter(([k])=>!['set-cookie'].includes(k)))},null,2));console.log(name,r.status,b.length);}catch(e){console.log(name,String(e));}}
