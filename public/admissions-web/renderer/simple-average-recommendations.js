import { institutionFor } from '../../data-core/university-scope-model.js';

export const SIMPLE_COMPARISON_NOTE = '입력된 석차등급의 단순평균과 표시된 기준등급을 숫자로만 비교합니다. 한 학기만 있어도 계산합니다. 대학별 환산식·실기·지원 학년도·등급제 차이는 반영하지 않은 참고 목록이며 합격 가능성이나 합격 보장이 아닙니다.';
export function gradeNumber(value) {
  if (!['number','string'].includes(typeof value) || String(value).trim()==='') return null;
  const n=Number(value);return Number.isFinite(n)&&n>=1&&n<=9?n:null;
}
export function studentAverage(student) {
  const detailed=(Array.isArray(student?.detailedTranscript)?student.detailedTranscript:[]).map(row=>gradeNumber(row?.grade)).filter(n=>n!==null);
  const simple=[];
  for(const grade of ['grade1','grade2','grade3'])for(const semester of ['semester1','semester2'])for(const subject of ['korean','english','math','social','science']){
    const value=gradeNumber(student?.termGrades?.[grade]?.[semester]?.[subject]);if(value!==null)simple.push(value);
  }
  const values=detailed.length?detailed:simple;
  if(values.length)return {value:values.reduce((sum,n)=>sum+n,0)/values.length,count:values.length,source:detailed.length?'상세 학생부 단순평균':'학기별 과목 단순평균'};
  const stored=gradeNumber(student?.gpa);return {value:stored,count:stored===null?0:1,source:stored===null?'성적 미입력':'저장된 평균등급'};
}
export function criterionFor(university, officialStats=null) {
  // Mirror the university editor's displayed stats. A blank official minimum must not revive a hidden legacy minimum.
  const displayedStats=officialStats||university?.acceptedStats;
  const worst=gradeNumber(displayedStats?.worst);
  if(worst!==null)return {value:worst,label:officialStats?'공식 최종등록자 최저등급':'등록된 최저합격등급'};
  // cutGpa and averages are not necessarily minimum accepted grades.
  return null;
}
export function compareSimpleAverage(student, universities, {excludedIds=[],match=()=>true,officialStatsFor=()=>null}={}) {
  const average=studentAverage(student),excluded=new Set(excludedIds.map(String));
  const result={mode:'simple-average',average,matches:[],schools:[],pending:[],note:SIMPLE_COMPARISON_NOTE};
  const groups=new Map();
  for(const u of universities||[]) {
    if(!u||excluded.has(String(u.id))||!match(u))continue;
    const criterion=criterionFor(u,officialStatsFor(u));
    if(!criterion){result.pending.push({u,reason:'최저합격등급 미입력'});continue;}
    if(average.value===null||average.value-criterion.value>1e-10)continue;
    const item={u,criterion,average:average.value};result.matches.push(item);
    const institution=institutionFor(u),key=institution?'institution:'+institution.name:'name:'+String(u.name||'').normalize('NFKC').replace(/\s/g,'');
    if(!groups.has(key))groups.set(key,{name:institution?institution.name+(institution.campus?' ('+institution.campus+')':''):u.name,items:[]});groups.get(key).items.push(item);
  }
  result.schools=Array.from(groups.values()).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
  for(const school of result.schools)school.items.sort((a,b)=>a.criterion.value-b.criterion.value||String(a.u.major).localeCompare(String(b.u.major),'ko'));
  return result;
}
