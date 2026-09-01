(function(global){
  function findRule(rules, university, year){
    const candidates = (rules || []).filter(rule =>
      rule.active !== false &&
      (!year || Number(rule.admissionYear) === Number(year)) &&
      (!university?.id || Number(rule.universityId) === Number(university.id))
    );
    return candidates.find(rule => rule.verificationStatus === 'VERIFIED') || candidates[0] || null;
  }
  function normalizeRule(rule){
    if(!rule) return null;
    return {
      calculationBasis: 'GRADE',
      selectionType: 'ALL',
      creditWeighting: 'NONE',
      maxScore: 400,
      baseScore: 0,
      roundingMethod: 'ROUND',
      decimalPlaces: 2,
      includeCareerSubjects: true,
      verificationStatus: 'DRAFT',
      ...rule
    };
  }
  global.RuleInterpreter = { findRule, normalizeRule };
})(window);
