(function(global){
  function gradeToScore(record, rule){
    const basis = rule?.calculationBasis || 'GRADE';
    if(basis === 'ACHIEVEMENT'){
      const score = rule?.achievementConversionTable?.[record.achievement];
      return Number.isFinite(Number(score)) ? Number(score) : null;
    }
    if(basis === 'RAW_SCORE') return Number.isFinite(Number(record.rawScore)) ? Number(record.rawScore) : null;
    if(basis === 'PERCENTILE') return Number.isFinite(Number(record.percentile)) ? Number(record.percentile) : null;
    const grade = String(record.grade ?? '').trim();
    const score = rule?.gradeConversionTable?.[grade];
    return Number.isFinite(Number(score)) ? Number(score) : null;
  }
  global.GradeConverter = { gradeToScore };
})(window);
