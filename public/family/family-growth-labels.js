(() => {
  const originalReportCard = window.reportCard;
  if (typeof originalReportCard !== 'function') return;

  function syncReceiptButtons(reportId, readAt) {
    document.querySelectorAll('[data-report-read]').forEach((button) => {
      if (button.dataset.reportRead !== String(reportId)) return;
      button.disabled = true;
      button.dataset.readAt = readAt || '';
      button.textContent = readAt ? `확인함 · ${String(readAt).slice(0, 10)}` : '확인함';
    });
  }

  async function markReportRead(button, report) {
    const studentId = document.getElementById('childSelect')?.value || '';
    if (!studentId || !report?.reportId || button.disabled) return;
    button.disabled = true;
    button.textContent = '확인 중...';
    try {
      const response = await fetch(
        `/api/family/children/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(report.reportId)}/read`,
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || '평가 확인 상태를 저장하지 못했습니다.');
      report.readAt = body.readAt || report.readAt || new Date().toISOString();
      syncReceiptButtons(report.reportId, report.readAt);
    } catch (error) {
      button.disabled = false;
      button.textContent = '평가 확인하기';
      button.title = error?.message || '평가 확인 상태를 저장하지 못했습니다.';
    }
  }

  window.reportCard = function guardianEnhancedReportCard(report) {
    const article = originalReportCard(report);
    const labels = Array.isArray(report?.growthSkillLabels)
      ? report.growthSkillLabels.filter((label) => typeof label === 'string' && label.trim()).slice(0, 5)
      : [];
    if (labels.length) {
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
    }

    if (report?.reportId) {
      const receipt = document.createElement('div');
      receipt.className = 'guardian-report-receipt';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'report-read-button';
      button.dataset.reportRead = String(report.reportId);
      if (report.readAt) {
        button.disabled = true;
        button.dataset.readAt = String(report.readAt);
        button.textContent = `확인함 · ${String(report.readAt).slice(0, 10)}`;
      } else {
        button.textContent = '평가 확인하기';
        button.addEventListener('click', () => markReportRead(button, report));
      }
      receipt.append(button);
      article.append(receipt);
    }
    return article;
  };

  const style = document.createElement('style');
  style.textContent = '.guardian-growth-skills{display:grid;gap:8px;margin-top:14px}.guardian-growth-skills>b{font-size:13px;color:#45607f}.guardian-growth-skills .growth-chips{margin-top:0}.guardian-report-receipt{display:flex;justify-content:flex-end;margin-top:14px}.report-read-button{border:1px solid #c9d9eb;border-radius:999px;background:#f7fbff;color:#315a83;padding:8px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.report-read-button:disabled{cursor:default;opacity:.75;background:#eef6f2;color:#3f6f5c;border-color:#c8ddd3}';
  document.head.append(style);
})();
