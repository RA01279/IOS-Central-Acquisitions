import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';
const files=execFileSync('git',['ls-tree','-r','--name-only','32afb73'],{encoding:'utf8'}).trim().split('\n');
const changed=[];
for(const p of files){try{const original=execFileSync('git',['show',`32afb73:${p}`],{maxBuffer:20_000_000});const current=readFileSync(p);if(!original.equals(current)&&original.toString().replace(/\r\n/g,'\n')!==current.toString().replace(/\r\n/g,'\n'))changed.push(p);}catch{changed.push(`MISSING: ${p}`);}}
console.log(JSON.stringify(changed));
