import nextEnv from '@next/env';
import {spawnSync} from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());
const ref=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
if(!/^[a-z0-9]+$/.test(ref)) throw new Error('Invalid project reference');
const result=spawnSync('cmd.exe',['/d','/s','/c',`npx --yes supabase db advisors --linked --project-ref ${ref} --type security --level warn --output-format json`],{env:process.env,encoding:'utf8'});
console.log(result.stdout);console.error(result.stderr);
process.exitCode=result.status??1;
