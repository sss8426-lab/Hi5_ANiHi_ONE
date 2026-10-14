// User requested institution scope, 2026-10-14. Never delete the source university rows.
export const SCOPE_VERSION = 'approved-67-20261014';
export const SCOPE_RECORD_ID = 'admissions-university-scope:current';
export const SCOPE_RECORD_TYPE = 'admissions-university-scope';
export const INSTITUTIONS = Object.freeze([
 ['건국대학교','글로컬','충북'],['경기대학교','서울','서울'],['경남대학교'],['경운대학교'],['경성대학교'],['경일대학교'],['계명대학교','대명','대구'],['공주대학교'],['극동대학교'],['남서울대학교'],['대구가톨릭대학교'],['대구대학교'],['대구예술대학교'],['대전대학교'],['대진대학교'],['동국대학교','WISE','경북'],['동명대학교'],['동서대학교'],['동아대학교'],['동양대학교'],['명지대학교','용인','경기'],['목원대학교'],['목포대학교'],['배재대학교'],['백석대학교'],['부산대학교'],['상명대학교','천안','충남'],['상지대학교'],['서경대학교'],['서원대학교'],['세명대학교'],['세한대학교'],['순천대학교'],['순천향대학교'],['신경주대학교'],['영남대학교'],['영산대학교'],['예원예술대학교'],['용인대학교'],['인제대학교'],['전북대학교'],['전주대학교'],['조선대학교'],['중부대학교'],['중앙대학교','다빈치','경기'],['중원대학교'],['창원대학교'],['청주대학교'],['한남대학교'],['한밭대학교'],['한서대학교'],['한성대학교'],['호서대학교'],['경국대학교'],['백석문화대학교'],['백석예술대학교'],['서일대학교'],['연성대학교'],['용인예술과학대학교'],['인덕대학교'],['청강문화산업대학교'],['한국영상대학교'],['한양여자대학교'],['한국예술종합학교'],['SWA 서울웹툰아카데미'],['서강대학교 미래교육원'],['서울종합예술실용학교'],
].map(([name,campus,region])=>Object.freeze({name,campus:campus||null,region:region||null})));
const norm = v => String(v??'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const base = v => norm(v).replace(/\([^)]*\)/g,'').split('_')[0].replace(/^국립/,'').replace(/대학교$/,'대').replace(/대학$/,'대').replace(/여대$/,'여자대');
const aliases = new Map([['안동대','경국대학교'],['경국대','경국대학교'],['국립경국대','경국대학교'],['경주대','신경주대학교'],['신경주대','신경주대학교'],['용인송담대','용인예술과학대학교'],['한예종','한국예술종합학교'],['swa서울웹툰아카데미','SWA 서울웹툰아카데미'],['서울웹툰아카데미','SWA 서울웹툰아카데미'],['서강대학교미래교육원','서강대학교 미래교육원']]);
const names = new Map(INSTITUTIONS.map(i=>[base(i.name),i]));
export function institutionFor(row){
 const value=typeof row==='string'?{name:row}:row||{};
 const n=norm(value.name||value.universityName); const b=base(value.name||value.universityName);
 // These are not interchangeable with their parent universities.
 if(b==='서강대'&&!n.includes('미래교육원')) return null;
 const match=names.get(b)||names.get(base(aliases.get(b)||aliases.get(n)));
 if(!match) return null;
 if(!match.campus) return match;
 const suffix = n.includes('_')?n.split('_').slice(1).join('_'):'';
 const explicit=norm(value.campus||value.campusName||suffix||(/\(([^)]+)\)/.exec(String(value.name||''))?.[1]||''));
 const target=norm(match.campus);
 const allowed={글로컬:['글로컬','glocal','충주'],서울:['서울'],대명:['대명'],wise:['wise','경주'],용인:['용인','자연','자연과학'],천안:['천안'],다빈치:['다빈치','안성']};
 if(explicit) return (allowed[target]||[target]).some(a=>explicit.includes(a))?match:null;
 if(target==='대명') return /^(영상애니메이션)(과|학과|전공)?$/.test(String(value.major||'').split('_')[0])?match:null;
 const region=norm(value.region||value.area||value.location);
 // Regional evidence is accepted only for legacy records lacking a campus field.
 return region && region===norm(match.region)?match:null;
}
export function scopePlan(rows){
 const kept=[],excluded=[]; const present=new Set();
 for(const row of rows||[]){const institution=institutionFor(row); if(institution){kept.push(row);present.add(institution.name);}else excluded.push({id:String(row.id),name:row.name});}
 return {version:SCOPE_VERSION,institutions:INSTITUTIONS,keptCount:kept.length,excluded,missing:INSTITUTIONS.filter(i=>!present.has(i.name)).map(i=>i.name)};
}
export function excludedIds(rows, entries){
 const current=new Map((rows||[]).map(r=>[String(r.id),r.name]));
 return (entries||[]).filter(r=>current.get(String(r.id))===r.name).map(r=>String(r.id));
}
