(function(global){
  function buildRows(records, rule){
    return records.map(record => ({
      schoolYear: record.schoolYear,
      semester: record.semester,
      subjectGroup: record.subjectGroupLabel || record.subjectGroup,
      subjectName: record.subjectName,
      originalGrade: record.grade ?? '-',
      convertedScore: record.included ? record.convertedScore ?? '-' : '-',
      credits: record.credits ?? '-',
      included: record.included,
      reason: record.included ? '반영' : record.excludeReason || '제외'
    }));
  }
  function summary(records, rule, finalScore){
    const included = records.filter(record => record.included);
    return {
      selectedSubjectCount: included.length,
      conversionTotal: included.reduce((sum, record) => sum + Number(record.convertedScore || 0), 0),
      maxScore: rule.maxScore,
      finalScore
    };
  }
  global.CalculationExplainer = { buildRows, summary };
})(window);
