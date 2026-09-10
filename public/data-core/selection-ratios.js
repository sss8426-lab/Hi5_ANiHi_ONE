// A complete single-stage percentage formula is required; never infer a missing component.
export function selectionRatios(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const empty = {gradeRatio:null,csatRatio:null,practicalRatio:null,documentRatio:null,interviewRatio:null,academicRatio:null,otherRatio:null,ratioStatus:/단계|[12]차|배수/.test(text)?'staged':'unresolved'};
  if (!text || text.length>1600 || /단계|차|배수|점|이상|이하|또는|중|가산|조건/.test(text)) return empty;
  const keys = {'학생부교과':'gradeRatio','학생부':'gradeRatio','교과':'gradeRatio','내신':'gradeRatio','수능':'csatRatio','실기':'practicalRatio','서류':'documentRatio','면접':'interviewRatio','출결':'attendanceRatio','봉사':'serviceRatio'};
  const parts=text.split(/[+＋/,\n]/).map(v=>v.trim());
  if(parts.some(v=>!v))return empty;
  const values={};
  for(const part of parts){
    const match=part.match(/^(학생부\s*교과|학생부|교과|내신|수능|실기|서류|면접|출결|봉사)\s*:?\s*(\d+(?:\.\d+)?)\s*%?$/);
    if(!match)return empty;
    const key=keys[match[1].replace(/\s/g,'')], n=Number(match[2]);
    if(key in values || n<0 || n>100)return empty;
    values[key]=n;
  }
  if(Math.abs(Object.values(values).reduce((s,v)=>s+v,0)-100)>1e-8)return empty;
  const result={...empty,...Object.fromEntries(Object.keys(empty).filter(k=>k.endsWith('Ratio')).map(k=>[k,0])),...values,ratioStatus:'simple'};
  result.academicRatio=result.gradeRatio+result.csatRatio;
  result.otherRatio=result.documentRatio+result.interviewRatio+(result.attendanceRatio||0)+(result.serviceRatio||0);
  return result;
}
