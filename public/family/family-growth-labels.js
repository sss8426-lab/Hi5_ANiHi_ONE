(() => {
  const originalReportCard = window.reportCard;
  if (typeof originalReportCard !== 'function') return;

  window.reportCard = function guardianGrowthLabelReportCard(report) {
    const article = originalReportCard(report);
    const labels = Array.isArray(report?.growthSkillLabels)
      ? report.growthSkillLabels.filter((label) => typeof label === 'string' && label.trim()).slice(0, 5)
      : [];
    if (!labels.length) return article;

    const section = document.createElement('div');
    section.className = 'guardian-growth-skills';
    const heading = document.createElement('b');
    heading.textContent = '이번 달 성장영역';
    const chips = document.createElement('div');
    chips.className = 'growth-chips';
    labels.forEach((label) => {
      const chip = document.createElement('span');
      chip.textContent = label;
      chips.append(chip);
    });
    section.append(heading, chips);
    article.append(section);
    return article;
  };

  const style = document.createElement('style');
  style.textContent = '.guardian-growth-skills{display:grid;gap:8px;margin-top:14px}.guardian-growth-skills>b{font-size:13px;color:#45607f}.guardian-growth-skills .growth-chips{margin-top:0}';
  document.head.append(style);
})();
