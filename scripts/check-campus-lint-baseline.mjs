import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const base = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(base || '')) throw new Error('Pass the verified base SHA.');
const git = (...args) => execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
const changed = [...new Set([...git('diff','--name-only',base).trim().split('\n'),...git('ls-files','--others','--exclude-standard').trim().split('\n')])].filter(p=>/\.(ts|js|mjs)$/.test(p));
const eslint = new ESLint();
const signature = m => `${m.ruleId}:${m.message}`;
let before=0,after=0;const added=[];
for (const path of changed) {
  let old='';try {old=git('show',`${base}:${path}`);}catch{ /* New file. */ }
  const prior=old?(await eslint.lintText(old,{filePath:resolve(path)}))[0]:null;
  const current=(await eslint.lintFiles([path]))[0];
  const counts=new Map();
  for(const m of prior?.messages || []) if(m.severity===2){before++;const key=signature(m);counts.set(key,(counts.get(key)||0)+1);}
  for(const m of current?.messages || []) if(m.severity===2){after++;const key=signature(m);if(counts.get(key)>0)counts.set(key,counts.get(key)-1);else added.push({path,line:m.line,rule:m.ruleId,message:m.message});}
}
console.log(JSON.stringify({changedFiles:changed.length,baselineErrors:before,currentErrors:after,newErrors:added},null,2));
process.exitCode=added.length?1:0;
