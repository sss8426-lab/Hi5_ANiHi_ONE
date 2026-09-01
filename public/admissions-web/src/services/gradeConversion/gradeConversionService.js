(function(global){
  const groupMap = {
    korean: ['KOREAN', '국어'],
    english: ['ENGLISH', '영어'],
    math: ['MATH', '수학'],
    social: ['SOCIAL', '사회'],
    science: ['SCIENCE', '과학']
  };
  function recordsFromStudent(student){
    if(global.AdmissionRuleEngine?.recordsFromStudent){
      return global.AdmissionRuleEngine.recordsFromStudent(student).subjects.map((subject, index) => ({
        studentId: student?.id || null,
        schoolYear: subject.grade,
        semester: subject.semester,
        subjectGroup: subject.category,
        subjectGroupLabel: subject.category_label,
        subjectName: subject.subject,
        subjectType: subject.subject_type,
        grade: subject.rank_grade,
        achievement: subject.achievement,
        credits: subject.credit,
        __id: index
      }));
    }
    const rows = typeof termRows === 'function' ? termRows() : [];
    const subjects = typeof subjectFields === 'object' ? subjectFields : [];
    return rows.flatMap(row => subjects.map(subject => {
      const score = typeof termScoreValue === 'function' ? termScoreValue(student, row, subject.key) : '';
      return {
        studentId: student?.id || null,
        schoolYear: Number(row.gradeKey.replace('grade','')),
        semester: Number(row.semesterKey.replace('semester','')),
        subjectGroup: groupMap[subject.key]?.[0] || 'ETC',
        subjectGroupLabel: groupMap[subject.key]?.[1] || subject.label,
        subjectName: subject.label,
        subjectType: 'GENERAL',
        grade: score === '' ? null : Number(score),
        rawScore: null,
        averageScore: null,
        standardDeviation: null,
        percentile: null,
        achievement: null,
        credits: 1,
        rank: null,
        studentCount: null
      };
    })).filter(record => Number.isFinite(Number(record.grade)));
  }
  function resultRowsFromEngine(result){
    return (result.selected_subjects || []).map(subject => ({
      schoolYear: subject.grade,
      semester: subject.semester,
      subjectGroup: subject.category,
      subjectName: subject.subject,
      originalGrade: subject.rank_grade ?? subject.achievement ?? '-',
      convertedScore: subject.converted_score ?? '-',
      credits: subject.credit ?? '-',
      included: true,
      reason: '반영'
    }));
  }
  function calculate(student, university, rawRule){
    if(global.AdmissionRuleEngine?.calculateStudentScore){
      const normalizedRule = global.AdmissionRuleEngine.normalizeAdmissionRule(rawRule, university);
      if(!normalizedRule) return { ok:false, reason:'규칙 확인 필요', university };
      const result = global.AdmissionRuleEngine.calculateStudentScore(student, normalizedRule);
      const detailRows = resultRowsFromEngine(result);
      return {
        ok: result.ok,
        reason: result.reason,
        rule: normalizedRule,
        university,
        originalAverage: result.original_average,
        convertedGrade: result.converted_grade,
        convertedAverage: result.converted_average,
        finalScore: result.final_score,
        maxScore: result.student_record_max_score,
        warning: normalizedRule.verified ? '' : '이 대학의 환산식은 아직 검증되지 않았습니다.',
        detailRows,
        selectedSubjects: result.selected_subjects,
        careerSubjects: result.career_subjects,
        attendanceScore: result.attendance_score,
        bonusScore: result.bonus_score,
        explanation: result.explanation,
        source: result.source,
        summary: {
          selectedSubjectCount: result.selected_subjects.length,
          conversionTotal: result.selected_subjects.reduce((sum, subject) => sum + Number(subject.converted_score || 0), 0),
          maxScore: result.student_record_max_score,
          finalScore: result.final_score
        }
      };
    }
    const rule = global.RuleInterpreter.normalizeRule(rawRule);
    if(!rule) return { ok:false, reason:'규칙 확인 필요', university };
    let records = recordsFromStudent(student).map((record, index) => ({ ...record, __id: index }));
    records = global.SubjectSelector.prepareRecords(records, rule)
      .map(record => ({ ...record, convertedScore: global.GradeConverter.gradeToScore(record, rule) }));
    records = global.SubjectSelector.select(records, rule);
    const convertedAverage = global.GradeWeightCalculator.weightedAverage(records, rule);
    const originalAverage = global.GradeWeightCalculator.originalAverage(records);
    const ratio = Number.isFinite(convertedAverage) ? convertedAverage / 100 : null;
    const rawFinal = Number.isFinite(ratio) ? Number(rule.baseScore || 0) + (Number(rule.maxScore || 400) - Number(rule.baseScore || 0)) * ratio : null;
    const finalScore = global.GradeConversionRoundingService.apply(rawFinal, rule);
    const convertedGrade = Number.isFinite(convertedAverage) ? global.GradeConversionRoundingService.apply(10 - convertedAverage / 10, { roundingMethod:'ROUND', decimalPlaces:2 }) : null;
    return {
      ok: Number.isFinite(finalScore),
      rule,
      university,
      originalAverage,
      convertedGrade,
      convertedAverage,
      finalScore,
      maxScore: rule.maxScore,
      warning: rule.verificationStatus === 'VERIFIED' ? '' : '⚠ 이 대학의 환산식은 아직 검증되지 않았습니다.',
      detailRows: global.CalculationExplainer.buildRows(records, rule),
      summary: global.CalculationExplainer.summary(records, rule, finalScore)
    };
  }
  function calculateForUniversities(student, universities, rules, year){
    return (universities || []).map(university => {
      const rule = global.RuleInterpreter.findRule(rules, university, year || university.year);
      return calculate(student, university, rule);
    });
  }
  global.GradeConversionService = { recordsFromStudent, calculate, calculateForUniversities };
})(window);
