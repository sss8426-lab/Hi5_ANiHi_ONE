(function(global){
  function semesterKey(record){
    return `${record.schoolYear}-${record.semester}`;
  }
  function isSemesterIncluded(record, rule){
    const semesters = Array.isArray(rule?.includedSemesters) ? rule.includedSemesters : [];
    if(!semesters.length) return true;
    return semesters.some(item => Number(item.year) === Number(record.schoolYear) && Number(item.semester) === Number(record.semester));
  }
  function isSubjectGroupIncluded(record, rule){
    const groups = Array.isArray(rule?.subjectGroups) ? rule.subjectGroups : [];
    if(!groups.length || groups.includes('ALL')) return true;
    return groups.includes(record.subjectGroup);
  }
  function prepareRecords(records, rule){
    return records.map(record => {
      if(!isSemesterIncluded(record, rule)) return { ...record, included: false, excludeReason: '반영학기 아님' };
      if(!isSubjectGroupIncluded(record, rule)) return { ...record, included: false, excludeReason: '반영교과 아님' };
      if(record.subjectType === 'CAREER' && rule?.includeCareerSubjects === false) return { ...record, included: false, excludeReason: '진로선택과목 미반영' };
      return { ...record, included: true, excludeReason: '' };
    });
  }
  function selectTop(records, count, keyFn){
    const included = records.filter(record => record.included);
    const grouped = included.reduce((map, record) => {
      const key = keyFn(record);
      map[key] = map[key] || [];
      map[key].push(record);
      return map;
    }, {});
    const selected = new Set();
    Object.values(grouped).forEach(group => {
      group
        .slice()
        .sort((a,b) => Number(b.convertedScore || 0) - Number(a.convertedScore || 0))
        .slice(0, count)
        .forEach(record => selected.add(record.__id));
    });
    return records.map(record => {
      if(!record.included) return record;
      return selected.has(record.__id) ? record : { ...record, included: false, excludeReason: `상위 ${count}과목에서 제외` };
    });
  }
  function select(records, rule){
    const type = rule?.selectionType || 'ALL';
    const count = Number(rule?.selectionCount || 0);
    if(type === 'TOP_N' && count > 0) return selectTop(records, count, () => 'ALL');
    if(type === 'TOP_N_PER_GROUP' && count > 0) return selectTop(records, count, record => record.subjectGroup);
    if(type === 'TOP_N_PER_SEMESTER' && count > 0) return selectTop(records, count, semesterKey);
    if(type === 'BEST_GRADE') return selectTop(records, 1, () => 'ALL');
    return records;
  }
  global.SubjectSelector = { prepareRecords, select };
})(window);
