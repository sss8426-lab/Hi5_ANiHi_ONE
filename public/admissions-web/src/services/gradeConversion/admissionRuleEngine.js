(function(global){
  const subjectGroupMap = {
    korean: { code: 'KOREAN', label: '국어' },
    english: { code: 'ENGLISH', label: '영어' },
    math: { code: 'MATH', label: '수학' },
    social: { code: 'SOCIAL', label: '사회' },
    science: { code: 'SCIENCE', label: '과학' }
  };
  const groupAliases = {
    KOREAN: ['KOREAN', '국어'],
    ENGLISH: ['ENGLISH', '영어'],
    MATH: ['MATH', '수학'],
    SOCIAL: ['SOCIAL', '사회', '사탐', '통합사회', '한국사'],
    SCIENCE: ['SCIENCE', '과학', '과탐', '통합과학'],
    ART: ['ART', '미술', '예술'],
    ETC: ['ETC', '기타']
  };
  const defaultTermRows = [
    { gradeKey: 'grade1', schoolYear: 1, semesterKey: 'semester1', semester: 1 },
    { gradeKey: 'grade1', schoolYear: 1, semesterKey: 'semester2', semester: 2 },
    { gradeKey: 'grade2', schoolYear: 2, semesterKey: 'semester1', semester: 1 },
    { gradeKey: 'grade2', schoolYear: 2, semesterKey: 'semester2', semester: 2 },
    { gradeKey: 'grade3', schoolYear: 3, semesterKey: 'semester1', semester: 1 },
    { gradeKey: 'grade3', schoolYear: 3, semesterKey: 'semester2', semester: 2 }
  ];
  const defaultSubjectFields = [
    { key: 'korean', label: '국어' },
    { key: 'english', label: '영어' },
    { key: 'math', label: '수학' },
    { key: 'social', label: '사탐' },
    { key: 'science', label: '과탐' }
  ];
  const defaultGradeTable = { '1': 100, '2': 98, '3': 95, '4': 90, '5': 83, '6': 75, '7': 65, '8': 50, '9': 30 };

  const AdmissionRuleSchema = {
    academic_year: 'number',
    university: 'string',
    campus: 'string',
    department: 'string',
    admission_type: 'string',
    rule_version: 'string',
    status: 'DRAFT | AI_ANALYZED | REVIEW_REQUIRED | VERIFIED | ACTIVE | ARCHIVED',
    ratios: {
      student_record: 'number',
      practical: 'number',
      interview: 'number',
      documents: 'number'
    },
    semester_rule: {
      type: 'ALL | FIRST_5_SEMESTERS | ALL_5_SEMESTERS | CUSTOM',
      included_semesters: [{ grade: 'number', semester: 'number' }]
    },
    subject_rules: [{
      subjects: ['KOREAN | ENGLISH | MATH | SOCIAL | SCIENCE | ART | ETC | ALL'],
      selection: 'ALL | BEST_N | BEST_N_BY_GROUP | BEST_N_BY_SEMESTER | BEST_GRADE',
      count: 'number',
      career_max: 'number'
    }],
    career_grade_conversion: { A: 'number', B: 'number', C: 'number' },
    grade_conversion_table: { 1: 'number', 2: 'number', 3: 'number' },
    credit_weight: 'boolean',
    year_weights: { 1: 'number', 2: 'number', 3: 'number' },
    subject_group_weights: {},
    attendance: { enabled: 'boolean', ratio: 'number', score: 'number' },
    bonus: { score: 'number' },
    deduction: { score: 'number' },
    source: { file: 'string', page: 'string | number', text: 'string' },
    confidence: {},
    verified: 'boolean'
  };

  const StudentRecordSchema = {
    student_id: 'string | number',
    name: 'string',
    subjects: [{
      grade: 'number',
      semester: 'number',
      category: 'string',
      subject: 'string',
      subject_type: 'GENERAL | CAREER',
      rank_grade: 'number | null',
      achievement: 'A | B | C | null',
      credit: 'number'
    }]
  };

  function toNumber(value, fallback = null){
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function uniqueValues(values){
    return [...new Set(values.filter(Boolean))];
  }
  function standardSubjectCode(value){
    const compact = String(value || '').replace(/\s/g, '').toUpperCase();
    const found = Object.entries(groupAliases).find(([, aliases]) =>
      aliases.some(alias => compact === String(alias).replace(/\s/g, '').toUpperCase())
    );
    return found?.[0] || compact || 'ETC';
  }
  function subjectLabel(code){
    return groupAliases[code]?.[1] || code || '기타';
  }
  function selectionType(value){
    const type = String(value || 'ALL').toUpperCase();
    if(['TOP_N', 'BEST_N'].includes(type)) return 'BEST_N';
    if(['TOP_N_PER_GROUP', 'BEST_N_BY_GROUP'].includes(type)) return 'BEST_N_BY_GROUP';
    if(['TOP_N_PER_SEMESTER', 'BEST_N_BY_SEMESTER'].includes(type)) return 'BEST_N_BY_SEMESTER';
    if(type === 'BEST_GRADE') return 'BEST_GRADE';
    return 'ALL';
  }
  function semesterRuleFromLegacy(rule){
    const included = Array.isArray(rule?.includedSemesters) ? rule.includedSemesters : [];
    if(!included.length) return { type: 'ALL', included_semesters: [] };
    const firstFive = '1-1,1-2,2-1,2-2,3-1';
    const allFive = '1-1,1-2,2-1,2-2,3-1,3-2';
    const key = included.map(item => `${Number(item.year)}-${Number(item.semester)}`).join(',');
    if(key === firstFive) return { type: 'FIRST_5_SEMESTERS', included_semesters: included.map(item => ({ grade: Number(item.year), semester: Number(item.semester) })) };
    if(key === allFive) return { type: 'ALL_5_SEMESTERS', included_semesters: included.map(item => ({ grade: Number(item.year), semester: Number(item.semester) })) };
    return { type: 'CUSTOM', included_semesters: included.map(item => ({ grade: Number(item.year), semester: Number(item.semester) })) };
  }
  function normalizeAdmissionRule(rawRule, university = {}){
    if(!rawRule) return null;
    if(rawRule.academic_year || rawRule.subject_rules || rawRule.semester_rule){
      return {
        ratios: { student_record: 100, practical: 0, interview: 0, documents: 0, ...(rawRule.ratios || {}) },
        semester_rule: { type: 'ALL', included_semesters: [], ...(rawRule.semester_rule || {}) },
        subject_rules: rawRule.subject_rules?.length ? rawRule.subject_rules : [{ subjects: ['ALL'], selection: 'ALL', count: 0 }],
        career_grade_conversion: rawRule.career_grade_conversion || rawRule.achievementConversionTable || {},
        grade_conversion_table: rawRule.grade_conversion_table || rawRule.gradeConversionTable || defaultGradeTable,
        qualification_exam_conversion_table: rawRule.qualification_exam_conversion_table || rawRule.qualificationExamConversionTable || [],
        credit_weight: Boolean(rawRule.credit_weight),
        year_weights: rawRule.year_weights || {},
        subject_group_weights: rawRule.subject_group_weights || {},
        max_score: toNumber(rawRule.max_score ?? rawRule.maxScore, 400),
        base_score: toNumber(rawRule.base_score ?? rawRule.baseScore, 0),
        rounding: rawRule.rounding || { method: rawRule.roundingMethod || 'ROUND', decimal_places: toNumber(rawRule.decimalPlaces, 2) },
        status: rawRule.status || rawRule.verificationStatus || 'DRAFT',
        verified: rawRule.verified ?? ['VERIFIED', 'ACTIVE'].includes(rawRule.status || rawRule.verificationStatus),
        source: rawRule.source && typeof rawRule.source === 'object' ? rawRule.source : { file: rawRule.source || '', page: rawRule.sourcePage || '', text: rawRule.sourceText || rawRule.notes || '' },
        ...rawRule
      };
    }
    const groups = Array.isArray(rawRule.subjectGroups) && rawRule.subjectGroups.length ? rawRule.subjectGroups : ['ALL'];
    return {
      academic_year: toNumber(rawRule.admissionYear || university.year, new Date().getFullYear()),
      university_id: rawRule.universityId || university.id || null,
      university: university.name || rawRule.university || '',
      campus: university.campus || '',
      department: university.major || rawRule.department || '',
      admission_type: university.admissionType || rawRule.admissionType || rawRule.ruleName || '',
      rule_version: rawRule.ruleVersion || String(rawRule.admissionYear || university.year || ''),
      ratios: {
        student_record: toNumber(university.academicWeight ?? rawRule.studentRecordRatio, 100),
        practical: toNumber(university.practicalWeight ?? rawRule.practicalRatio, 0),
        interview: toNumber(rawRule.interviewRatio, 0),
        documents: toNumber(rawRule.documentRatio, 0)
      },
      semester_rule: semesterRuleFromLegacy(rawRule),
      subject_rules: [{
        subjects: groups.map(standardSubjectCode),
        selection: selectionType(rawRule.selectionType),
        count: toNumber(rawRule.selectionCount, 0),
        career_max: toNumber(rawRule.careerMax, 0)
      }],
      career_grade_conversion: rawRule.careerGradeConversion || {},
      achievement_score_conversion: rawRule.achievementConversionTable || {},
      grade_conversion_table: rawRule.gradeConversionTable || defaultGradeTable,
      qualification_exam_conversion_table: rawRule.qualificationExamConversionTable || [],
      credit_weight: rawRule.creditWeighting === 'WEIGHTED',
      year_weights: rawRule.yearWeights || {},
      subject_group_weights: rawRule.subjectGroupWeights || {},
      attendance: { enabled: false, ratio: 0, score: 0, ...(rawRule.attendance || {}) },
      bonus: { score: toNumber(rawRule.bonusScore, 0) },
      deduction: { score: toNumber(rawRule.deductionScore, 0) },
      max_score: toNumber(rawRule.maxScore, 400),
      base_score: toNumber(rawRule.baseScore, 0),
      rounding: { method: rawRule.roundingMethod || 'ROUND', decimal_places: toNumber(rawRule.decimalPlaces, 2) },
      source: { file: rawRule.source || '', page: rawRule.sourcePage || '', text: rawRule.notes || '' },
      status: rawRule.verificationStatus || 'DRAFT',
      verified: rawRule.verificationStatus === 'VERIFIED' || rawRule.verificationStatus === 'ACTIVE',
      raw_rule: rawRule
    };
  }
  function normalizeStudentRecord(studentRecordOrStudent){
    if(!studentRecordOrStudent) return { student_id: '', name: '', subjects: [] };
    if(Array.isArray(studentRecordOrStudent.subjects)){
      return {
        student_id: studentRecordOrStudent.student_id || studentRecordOrStudent.studentId || studentRecordOrStudent.id || '',
        name: studentRecordOrStudent.name || '',
        subjects: studentRecordOrStudent.subjects.map(normalizeSubject).filter(subject => toNumber(subject.rank_grade) || subject.achievement)
      };
    }
    return recordsFromStudent(studentRecordOrStudent);
  }
  function normalizeSubject(subject){
    const code = standardSubjectCode(subject.category || subject.subjectGroup || subject.subjectGroupLabel);
    return {
      grade: toNumber(subject.grade ?? subject.schoolYear, 0),
      semester: toNumber(subject.semester, 0),
      category: code,
      category_label: subjectLabel(code),
      subject: subject.subject || subject.subjectName || subjectLabel(code),
      subject_type: subject.subject_type || subject.subjectType || 'GENERAL',
      rank_grade: toNumber(subject.rank_grade ?? subject.grade, null),
      achievement: subject.achievement || null,
      credit: toNumber(subject.credit ?? subject.credits, 1),
      raw: subject
    };
  }
  function recordsFromStudent(student){
    const termRows = typeof global.termRows === 'function'
      ? global.termRows().map(row => ({ gradeKey: row.gradeKey, schoolYear: Number(String(row.gradeKey).replace('grade','')), semesterKey: row.semesterKey, semester: Number(String(row.semesterKey).replace('semester','')) }))
      : defaultTermRows;
    const fields = Array.isArray(global.subjectFields) && global.subjectFields.length ? global.subjectFields : defaultSubjectFields;
    const subjects = termRows.flatMap(row => fields.map(field => {
      const score = student?.termGrades?.[row.gradeKey]?.[row.semesterKey]?.[field.key] ?? '';
      const group = subjectGroupMap[field.key] || { code: 'ETC', label: field.label };
      return normalizeSubject({
        grade: row.schoolYear,
        semester: row.semester,
        category: group.code,
        subject: field.label,
        subject_type: 'GENERAL',
        rank_grade: score,
        credit: 1
      });
    })).filter(subject => toNumber(subject.rank_grade) !== null);
    if(!subjects.length && toNumber(student.gpa)){
      subjects.push(normalizeSubject({
        grade: 3,
        semester: 1,
        category: 'ETC',
        subject: '내신 평균',
        subject_type: 'GENERAL',
        rank_grade: student.gpa,
        credit: 1
      }));
    }
    return { student_id: student?.id || '', name: student?.name || '', subjects };
  }
  function semesterIncluded(subject, rule){
    const semesterRule = rule.semester_rule || {};
    const type = String(semesterRule.type || 'ALL').toUpperCase();
    if(type === 'ALL') return true;
    if(type === 'FIRST_5_SEMESTERS') return subject.grade < 3 || (subject.grade === 3 && subject.semester === 1);
    if(type === 'ALL_5_SEMESTERS') return subject.grade <= 3;
    const included = Array.isArray(semesterRule.included_semesters) ? semesterRule.included_semesters : [];
    if(!included.length) return true;
    return included.some(item => Number(item.grade) === Number(subject.grade) && Number(item.semester) === Number(subject.semester));
  }
  function subjectAllowed(subject, rule){
    const rules = Array.isArray(rule.subject_rules) && rule.subject_rules.length ? rule.subject_rules : [{ subjects: ['ALL'], selection: 'ALL', count: 0 }];
    return rules.some(item => {
      const subjects = Array.isArray(item.subjects) && item.subjects.length ? item.subjects.map(standardSubjectCode) : ['ALL'];
      return subjects.includes('ALL') || subjects.includes(subject.category);
    });
  }
  function scoreForSubject(subject, rule){
    if(subject.subject_type === 'CAREER' && subject.achievement){
      const directScore = rule.achievement_score_conversion?.[subject.achievement];
      if(toNumber(directScore) !== null) return toNumber(directScore);
      const convertedGrade = rule.career_grade_conversion?.[subject.achievement];
      if(toNumber(convertedGrade) !== null) return scoreFromGradeTable(convertedGrade, rule.grade_conversion_table);
    }
    return scoreFromGradeTable(subject.rank_grade, rule.grade_conversion_table);
  }
  function scoreFromGradeTable(gradeValue, table = defaultGradeTable){
    const grade = toNumber(gradeValue, null);
    if(grade === null) return null;
    const exact = table?.[String(grade)];
    if(toNumber(exact) !== null) return toNumber(exact);
    const lowerGrade = Math.max(1, Math.floor(grade));
    const upperGrade = Math.min(9, Math.ceil(grade));
    const lowerScore = toNumber(table?.[String(lowerGrade)], null);
    const upperScore = toNumber(table?.[String(upperGrade)], null);
    if(lowerScore === null && upperScore === null) return null;
    if(lowerScore === null) return upperScore;
    if(upperScore === null || lowerGrade === upperGrade) return lowerScore;
    const ratio = grade - lowerGrade;
    return lowerScore + (upperScore - lowerScore) * ratio;
  }
  function weightForSubject(subject, rule){
    const creditWeight = rule.credit_weight ? toNumber(subject.credit, 1) : 1;
    const yearWeight = toNumber(rule.year_weights?.[String(subject.grade)], 1);
    const groupWeight = toNumber(rule.subject_group_weights?.[subject.category], 1);
    return creditWeight * yearWeight * groupWeight;
  }
  function pickBest(subjects, count, keyFn){
    if(!count || count <= 0) return subjects;
    const groups = subjects.reduce((map, subject) => {
      const key = keyFn(subject);
      map.set(key, [...(map.get(key) || []), subject]);
      return map;
    }, new Map());
    return [...groups.values()].flatMap(group =>
      group.slice().sort((a,b) => toNumber(b.converted_score, 0) - toNumber(a.converted_score, 0)).slice(0, count)
    );
  }
  function selectSubjects(subjects, rule){
    const subjectRule = (Array.isArray(rule.subject_rules) && rule.subject_rules[0]) || { selection: 'ALL', count: 0 };
    const count = toNumber(subjectRule.count, 0);
    const selection = selectionType(subjectRule.selection);
    if(selection === 'BEST_N') return pickBest(subjects, count, () => 'ALL');
    if(selection === 'BEST_N_BY_GROUP') return pickBest(subjects, count, subject => subject.category);
    if(selection === 'BEST_N_BY_SEMESTER') return pickBest(subjects, count, subject => `${subject.grade}-${subject.semester}`);
    if(selection === 'BEST_GRADE') return pickBest(subjects, 1, () => 'ALL');
    return subjects;
  }
  function applyRounding(value, rule){
    const method = String(rule.rounding?.method || 'ROUND').toUpperCase();
    const places = toNumber(rule.rounding?.decimal_places, 2);
    const factor = Math.pow(10, places);
    if(!Number.isFinite(value)) return null;
    if(method === 'NONE') return value;
    if(method === 'FLOOR') return Math.floor(value * factor) / factor;
    if(method === 'CEIL') return Math.ceil(value * factor) / factor;
    return Math.round(value * factor) / factor;
  }
  function qualificationExamAverage(record){
    const direct = toNumber(record?.qualificationExamAverage ?? record?.gedAverage ?? record?.examAverage, null);
    if(direct !== null) return direct;
    const text = `${record?.schoolType || ''} ${record?.highSchoolType || ''} ${record?.studentType || ''} ${record?.school || ''}`;
    if(!/검정/.test(text)) return null;
    const fallback = toNumber(record?.gpa, null);
    return fallback !== null && fallback > 9 ? fallback : null;
  }
  function qualificationExamResult(studentRecordOrStudent, rule){
    const table = Array.isArray(rule.qualification_exam_conversion_table) ? rule.qualification_exam_conversion_table : [];
    if(!table.length) return null;
    const average = qualificationExamAverage(studentRecordOrStudent);
    if(average === null) return null;
    const row = table.find(item => {
      const min = toNumber(item.min, 0);
      const max = toNumber(item.max, 100);
      return average >= min && average <= max;
    });
    if(!row) return null;
    const studentRecordMaxScore = toNumber(rule.max_score, 400);
    const studentRecordScore = applyRounding(toNumber(row.studentRecordScore ?? row.student_record_score ?? row.score, null), rule);
    const practicalScore = applyRounding(toNumber(row.practicalScore ?? row.practical_score, null), rule);
    const finalScore = studentRecordScore;
    return {
      ok: Number.isFinite(finalScore),
      university: rule.university,
      department: rule.department,
      admission_type: rule.admission_type,
      student_record_score: studentRecordScore,
      practical_score: practicalScore,
      student_record_max_score: studentRecordMaxScore,
      converted_grade: null,
      converted_average: average,
      original_average: average,
      selected_subjects: [],
      career_subjects: [],
      attendance_score: 0,
      bonus_score: 0,
      deduction_score: 0,
      final_score: finalScore,
      explanation: [
        `${rule.university || ''} ${rule.department || ''} ${rule.admission_type || ''}`.trim(),
        `검정고시 평균 ${average}점 구간 적용`,
        Number.isFinite(finalScore) ? `학생부 환산점수 ${finalScore} / ${studentRecordMaxScore}` : '검정고시 환산점수 확인 필요'
      ].filter(Boolean),
      source: rule.source,
      rule,
      student_record: normalizeStudentRecord(studentRecordOrStudent)
    };
  }
  function calculateStudentScore(studentRecordOrStudent, admissionRule){
    const rule = normalizeAdmissionRule(admissionRule);
    const studentRecord = normalizeStudentRecord(studentRecordOrStudent);
    if(!rule) return { ok: false, reason: '입시 규칙 확인 필요', selected_subjects: [], explanation: [] };
    const qualificationResult = qualificationExamResult(studentRecordOrStudent, rule);
    if(qualificationResult) return qualificationResult;
    const candidates = studentRecord.subjects
      .map(subject => {
        const converted_score = scoreForSubject(subject, rule);
        return { ...subject, converted_score, weight: weightForSubject(subject, rule) };
      })
      .filter(subject => semesterIncluded(subject, rule) && subjectAllowed(subject, rule) && Number.isFinite(subject.converted_score));
    const selected = selectSubjects(candidates, rule);
    const weightSum = selected.reduce((sum, subject) => sum + subject.weight, 0);
    const convertedAverage = weightSum
      ? selected.reduce((sum, subject) => sum + subject.converted_score * subject.weight, 0) / weightSum
      : null;
    const originalAverage = selected.length
      ? selected.reduce((sum, subject) => sum + toNumber(subject.rank_grade, 0), 0) / selected.length
      : null;
    const studentRecordMaxScore = toNumber(rule.max_score, 400);
    const baseScore = toNumber(rule.base_score, 0);
    const rawStudentRecordScore = Number.isFinite(convertedAverage)
      ? baseScore + (studentRecordMaxScore - baseScore) * (convertedAverage / 100)
      : null;
    const studentRecordScore = applyRounding(rawStudentRecordScore, rule);
    const attendanceScore = rule.attendance?.enabled ? toNumber(rule.attendance.score, 0) : 0;
    const bonusScore = toNumber(rule.bonus?.score, 0);
    const deductionScore = toNumber(rule.deduction?.score, 0);
    const finalScore = applyRounding(Number.isFinite(studentRecordScore) ? studentRecordScore + attendanceScore + bonusScore - deductionScore : null, rule);
    const convertedGrade = Number.isFinite(originalAverage) ? applyRounding(originalAverage, { rounding: { method: 'ROUND', decimal_places: 2 } }) : null;
    const selectedSubjects = selected.map(subject => ({
      grade: subject.grade,
      semester: subject.semester,
      category: subject.category_label,
      subject: subject.subject,
      subject_type: subject.subject_type,
      rank_grade: subject.rank_grade,
      achievement: subject.achievement,
      credit: subject.credit,
      converted_score: applyRounding(subject.converted_score, { rounding: { method: 'ROUND', decimal_places: 2 } }),
      weight: subject.weight
    }));
    const explanation = [
      `${rule.university || ''} ${rule.department || ''} ${rule.admission_type || ''}`.trim(),
      `학생부 ${rule.ratios?.student_record ?? '-'}% / 실기 ${rule.ratios?.practical ?? '-'}%`,
      rule.credit_weight ? '이수단위 적용' : '이수단위 미적용',
      ...selectedSubjects.map(subject => `${subject.subject} ${subject.rank_grade ?? subject.achievement}등급 / ${subject.credit}단위 반영`),
      Number.isFinite(finalScore) ? `최종 환산점수 ${finalScore} / ${studentRecordMaxScore}` : '환산 가능한 성적 데이터 없음'
    ].filter(Boolean);
    return {
      ok: Number.isFinite(finalScore),
      university: rule.university,
      department: rule.department,
      admission_type: rule.admission_type,
      student_record_score: studentRecordScore,
      student_record_max_score: studentRecordMaxScore,
      converted_grade: convertedGrade,
      converted_average: convertedAverage,
      original_average: originalAverage,
      selected_subjects: selectedSubjects,
      career_subjects: selectedSubjects.filter(subject => subject.subject_type === 'CAREER'),
      attendance_score: attendanceScore,
      bonus_score: bonusScore,
      deduction_score: deductionScore,
      final_score: finalScore,
      explanation,
      source: rule.source,
      rule,
      student_record: studentRecord
    };
  }

  global.AdmissionRuleEngine = {
    schemas: { AdmissionRuleSchema, StudentRecordSchema },
    normalizeAdmissionRule,
    normalizeStudentRecord,
    recordsFromStudent,
    calculateStudentScore
  };
})(window);
