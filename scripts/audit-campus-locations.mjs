import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import vm from 'node:vm';
const ctx=vm.createContext({window:{}});vm.runInContext(readFileSync('public/admissions-web/renderer/campus-locations.js','utf8'),ctx);
export function summarizeLocations(rows){
  const counts={verified:0,needs_review:0,unknown:0};
  const schools=new Set(),verifiedSchools=new Set(),reviewSchools=new Set(),unknownSchools=new Set(),institutions=new Set();
  for(const row of rows){
    schools.add(row.name);const location=ctx.window.AdmissionsCampusLocations.resolve(row),status=location.verificationStatus;
    counts[status]++;
    if(status==='verified'){verifiedSchools.add(row.name);institutions.add(location.schools[0]);}
    if(status==='needs_review')reviewSchools.add(row.name);
    if(status==='unknown')unknownSchools.add(row.name);
  }
  return {programRows:rows.length,schoolNameIdentities:schools.size,...counts,schoolsWithVerifiedPrograms:verifiedSchools.size,
    verifiedInstitutions:institutions.size,schoolsWithReviewPrograms:reviewSchools.size,schoolsWithUnknownPrograms:unknownSchools.size};
}

export function candidateFrequencies(rows){
  // Reuse only pure recommendation declarations. Never execute app boot, render,
  // scoring, browser APIs or private student profiles for this aggregate audit.
  const source=readFileSync('public/admissions-web/renderer/app.js','utf8');
  const ast=ts.createSourceFile('app.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const names=new Set(['isUniversityChecked','checkedUniversities','recommendationUniversities','dashboardTrackOptions','practicalTypeOptions','universityPracticalText','universityMatchesPracticalType','universityMatchesTrack','dashboardUniversitiesForTrack','practicalTypeRules']);
  const definitions=[];
  for(const statement of ast.statements){
    if(ts.isFunctionDeclaration(statement)&&names.has(statement.name?.text))definitions.push(statement.getText(ast));
    if(ts.isVariableStatement(statement))for(const decl of statement.declarationList.declarations){
      if(ts.isIdentifier(decl.name)&&names.has(decl.name.text))definitions.push(`const ${decl.getText(ast)};`);
    }
  }
  if(definitions.length!==names.size)throw Error('Recommendation declaration contract changed; audit needs review');
  const context=vm.createContext({window:{},state:{data:{universities:rows}}});
  for(const name of ['campus-locations','counseling-ux'])vm.runInContext(readFileSync(`public/admissions-web/renderer/${name}.js`,'utf8'),context);
  vm.runInContext(definitions.join('\n'),context);
  return vm.runInContext(`(()=>{
    const schools=new Map();let combinations=0;
    for(const track of dashboardTrackOptions())for(const type of ['',...practicalTypeOptions()]){
      combinations++;
      const candidates=dashboardUniversitiesForTrack(track,type);
      for(const row of candidates){
        const value=schools.get(row.name)||{school:row.name,candidateAppearances:0,top30Appearances:0,programs:new Set()};
        value.candidateAppearances++;value.programs.add(row.major);schools.set(row.name,value);
      }
      for(const {u} of window.AdmissionsCounselingUx.sortByDistance(candidates.map(u=>({u}))).slice(0,30))schools.get(u.name).top30Appearances++;
    }
    return {basis:'Existing recommendation functions over all track/practical-filter combinations; not user telemetry or student usage frequency',
      combinations,candidatePool:recommendationUniversities().length,
      top:[...schools.values()].sort((a,b)=>b.candidateAppearances-a.candidateAppearances).slice(0,20).map(({programs,...school})=>({...school,uniquePrograms:programs.size}))};
  })()`,context,{timeout:15000});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv.includes('--remote-read-only'))throw Error('Explicit --remote-read-only is required');
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','get','anihi-admissions-images/state/admissions-data.json','--remote','--pipe'],{
    encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024,env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG:'error',WRANGLER_LOG_SANITIZE:'true'},
  });
  if(result.status!==0)throw Error('Read-only audit failed. Raw output suppressed.');
  let data;try{data=JSON.parse(result.stdout);}catch{throw Error('Invalid audit response. Raw output suppressed.');}
  const rows=Array.isArray(data.universities)?data.universities:[];
  // Only counts, academic aggregates and irreversible fingerprints leave memory.
  console.log(JSON.stringify({all:summarizeLocations(rows),checked:summarizeLocations(rows.filter(u=>u.checkedComplete&&!u.hiddenDuplicate)),
    ...(process.argv.includes('--priorities')?{priorities:candidateFrequencies(rows)}:{}),
    fingerprints:Object.fromEntries(['students','universities','cases','awardFolders','settings'].map(k=>[k,createHash('sha256').update(JSON.stringify(data[k]??null)).digest('hex')]))},null,2));
}
