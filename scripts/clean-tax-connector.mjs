import {readFileSync,writeFileSync} from 'node:fs';
const p='lib/property-taxes/research.ts';let s=readFileSync(p,'utf8');
s=s.replace(/      \/\* Legacy point-only lookup[\s\S]*?      \*\/\r?\n/,'');
s=s.replace('Obtain dated assessor notices and collector bills/payment records.','Dated figures come only from separately verified official bills; earlier years and payments may remain unavailable.');
writeFileSync(p,s);
const t='lib/property-taxes/__tests__/research.test.ts';let tests=readFileSync(t,'utf8');tests=tests.replace('attributes:{TOTVAL1:100000,TAXTOT1:950}','attributes:{RPIN:"R6250 010",PIN:"6250 010",LOCADDR:"100 Main Road",TOTVAL1:100000,TAXTOT1:950}');writeFileSync(t,tests);
