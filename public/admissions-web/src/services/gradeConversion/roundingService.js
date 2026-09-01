(function(global){
  function apply(value, rule){
    const method = rule?.roundingMethod || 'ROUND';
    const places = Number.isFinite(Number(rule?.decimalPlaces)) ? Number(rule.decimalPlaces) : 2;
    const factor = Math.pow(10, places);
    if(!Number.isFinite(value)) return null;
    if(method === 'NONE') return value;
    if(method === 'FLOOR') return Math.floor(value * factor) / factor;
    if(method === 'CEIL') return Math.ceil(value * factor) / factor;
    return Math.round(value * factor) / factor;
  }
  global.GradeConversionRoundingService = { apply };
})(window);
