(function(global){
  function recordWeight(record, rule){
    const creditWeight = rule?.creditWeighting === 'WEIGHTED' ? Number(record.credits || 1) : 1;
    const yearWeight = rule?.yearWeights?.[String(record.schoolYear)] ?? 1;
    const groupWeight = rule?.subjectGroupWeights?.[record.subjectGroup] ?? 1;
    return creditWeight * Number(yearWeight || 1) * Number(groupWeight || 1);
  }
  function weightedAverage(records, rule){
    const included = records.filter(record => record.included && Number.isFinite(Number(record.convertedScore)));
    const weightSum = included.reduce((sum, record) => sum + recordWeight(record, rule), 0);
    if(!included.length || !weightSum) return null;
    const total = included.reduce((sum, record) => sum + Number(record.convertedScore) * recordWeight(record, rule), 0);
    return total / weightSum;
  }
  function originalAverage(records){
    const values = records.filter(record => record.included && Number.isFinite(Number(record.grade))).map(record => Number(record.grade));
    if(!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  global.GradeWeightCalculator = { recordWeight, weightedAverage, originalAverage };
})(window);
