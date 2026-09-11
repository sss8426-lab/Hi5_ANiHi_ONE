(() => {
  const $ = (id) => document.getElementById(id);
  let lastCampusId = '';
  let loading = false;
  let trendLoading = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function localYearMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function shiftYearMonth(yearMonth, offset) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || ''));
    if (!match) return localYearMonth();
    const date = new Date(Number(match[1]), Number(match[2]) - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function staff() {
    return window.KkumeumStaff || null;
  }

  function canPreview() {
    const core = staff();
    const context = core?.state?.context;
    const campusId = core?.state?.campusId;
    if (!context || !campusId) return false;
    if (context.isSuperAdmin) return true;
    return (context.memberships || []).some((membership) => (
      membership.campusId === campusId && ['CAMPUS_DIRECTOR', 'CAMPUS_ADMIN'].includes(membership.role)
    ));
  }

  function showForAccess() {
    const allowed = canPreview();
    const section = $('kkAnalyticsSection');
    document.querySelectorAll('.kk-analytics-nav').forEach((node) => { node.hidden = !allowed; });
    if (section) section.hidden = !allowed;
    return allowed;
  }

  function setFeedback(message) {
    const node = $('kkAnalyticsFeedback');
    if (node) node.textContent = message;
  }

  function growthSkillsNode() {
    let node = $('kkAnalyticsGrowthSkills');
    if (node) return node;
    const breakdown = $('kkAnalyticsBreakdown');
    if (!breakdown?.parentElement) return null;
    node = document.createElement('div');
    node.id = 'kkAnalyticsGrowthSkills';
    node.className = 'kk-empty';
    node.innerHTML = '<strong>이번 달 성장영역</strong><p>현재 taxonomy의 표준 성장영역만 안전하게 집계합니다.</p>';
    breakdown.insertAdjacentElement('afterend', node);
    return node;
  }

  function trendNode() {
    let node = $('kkAnalyticsTrend');
    if (node) return node;
    const growth = growthSkillsNode();
    if (!growth?.parentElement) return null;
    node = document.createElement('div');
    node.id = 'kkAnalyticsTrend';
    node.className = 'kk-empty';
    node.innerHTML = `
      <div class="kk-panel-head">
        <div><span>RECENT AGGREGATE TREND</span><strong>최근 흐름</strong></div>
        <label><span>조회 기간</span><select id="kkAnalyticsTrendMonths"><option value="3">최근 3개월</option><option value="6" selected>최근 6개월</option><option value="12">최근 12개월</option></select></label>
      </div>
      <button type="button" id="kkAnalyticsTrendRefresh">흐름 새로고침</button>
      <div id="kkAnalyticsTrendBody"><p>월별 집계 흐름을 불러옵니다. 개인별 변화량이나 순위는 제공하지 않습니다.</p></div>`;
    growth.insertAdjacentElement('afterend', node);
    $('kkAnalyticsTrendRefresh').onclick = () => loadTrend();
    $('kkAnalyticsTrendMonths').onchange = () => loadTrend();
    return node;
  }

  function renderCards(data) {
    const cards = $('kkAnalyticsCards');
    if (!cards) return;
    cards.innerHTML = [
      ['재원 학생', data.activeStudentCount, '개인별 명단 미표시'],
      ['평가 진행률', `${data.reports.completionRate}%`, `미작성 ${data.reports.missing} · 초안 ${data.reports.draft} · 검토 ${data.reports.ready}`],
      ['전달 완료', data.reports.sent, '보호자에게 sent 처리된 평가'],
      ['이번 달 작품', data.artworks.count, `학생당 평균 ${data.artworks.averagePerActiveStudent}개`],
    ].map(([label, value, note]) => (
      `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`
    )).join('');
  }

  function renderBreakdown(data) {
    const node = $('kkAnalyticsBreakdown');
    if (!node) return;
    if (data.stageBreakdown.suppressed) {
      node.innerHTML = `<strong>표본 부족으로 세부 분류를 숨겼습니다.</strong><p>수업 단계 중 ${escapeHtml(data.minimumCohortSize)}명 미만 집단이 있어 작은 집단의 인원을 역산할 수 없도록 전체 단계별 breakdown을 표시하지 않습니다.</p>`;
      return;
    }
    if (!data.stageBreakdown.buckets.length) {
      node.innerHTML = '<strong>표시할 수업 단계 집계가 없습니다.</strong><p>학생 원본이나 월간평가 본문은 이 화면에 표시하지 않습니다.</p>';
      return;
    }
    node.innerHTML = `<strong>수업 단계별 재원 집계</strong><div class="kk-class-grid">${data.stageBreakdown.buckets.map((bucket) => (
      `<button type="button" disabled><span>${escapeHtml(bucket.stage)}</span><b>${escapeHtml(bucket.studentCount)}</b></button>`
    )).join('')}</div><p>모든 표시 집단은 최소 ${escapeHtml(data.minimumCohortSize)}명 이상입니다.</p>`;
  }

  function renderGrowthSkills(data) {
    const node = growthSkillsNode();
    if (!node) return;
    const growthSkills = data.growthSkills;
    if (!growthSkills) {
      node.innerHTML = '<strong>성장영역 집계를 사용할 수 없습니다.</strong><p>표준 성장영역이 연결된 월간평가만 안전하게 집계합니다.</p>';
      return;
    }
    if (growthSkills.suppressed) {
      node.innerHTML = `<strong>표본 부족으로 세부 성장영역을 표시하지 않습니다.</strong><p>현재 표준 분류에 맞는 평가 수 또는 하나 이상의 성장영역 집계가 ${escapeHtml(data.minimumCohortSize)}건 미만이어서 작은 집단을 역산할 수 없도록 전체 성장영역 breakdown을 숨겼습니다.</p>`;
      return;
    }
    if (!growthSkills.buckets.length) {
      node.innerHTML = '<strong>이번 달 표준 성장영역 집계가 없습니다.</strong><p>자유서술 성장포인트나 이전 taxonomy 데이터는 자동 추측하거나 집계하지 않습니다.</p>';
      return;
    }
    const eligible = growthSkills.eligibleReportCount == null ? '' : ` · 집계 대상 평가 ${escapeHtml(growthSkills.eligibleReportCount)}건`;
    node.innerHTML = `<strong>이번 달 성장영역${eligible}</strong><div class="kk-class-grid">${growthSkills.buckets.map((bucket) => (
      `<button type="button" disabled><span>${escapeHtml(bucket.label)}<small>${escapeHtml(bucket.categoryLabel)}</small></span><b>${escapeHtml(bucket.reportCount)}</b></button>`
    )).join('')}</div><p>현재 표준 성장영역 코드만 집계하며 학생·교사 순위나 개인별 비교는 제공하지 않습니다.</p>`;
  }

  function renderTrend(data) {
    const body = $('kkAnalyticsTrendBody');
    if (!body) return;
    if (!data?.months?.length) {
      body.innerHTML = '<p>표시할 월별 집계가 없습니다.</p>';
      return;
    }
    body.innerHTML = `<div class="kk-class-grid">${data.months.map((month) => {
      const growth = month.growthSkills?.suppressed
        ? '성장영역: 표본 부족'
        : month.growthSkills?.buckets?.length
          ? `성장영역: ${month.growthSkills.buckets.map((bucket) => `${escapeHtml(bucket.label)} ${escapeHtml(bucket.reportCount)}`).join(' · ')}`
          : '성장영역: 집계 없음';
      return `<button type="button" disabled><span><strong>${escapeHtml(month.yearMonth)}</strong><small>평가 진행률 ${escapeHtml(month.reportCompletionRate)}% · 작품 평균 ${escapeHtml(month.artworkAveragePerActiveStudent)}개</small><small>${growth}</small></span><b>${escapeHtml(month.activeStudentCount)}명</b></button>`;
    }).join('')}</div><p>월별 안전 집계만 표시하며 변화량(delta), 개인별 추적, 학생·교사 순위는 계산하지 않습니다.</p>`;
  }

  async function loadTrend() {
    if (trendLoading || !showForAccess()) return;
    const core = staff();
    const campusId = core?.state?.campusId || '';
    if (!campusId || !core?.state?.health?.ok) return;
    trendNode();
    const endMonth = $('kkAnalyticsMonth')?.value || localYearMonth();
    const count = Math.min(12, Math.max(1, Number($('kkAnalyticsTrendMonths')?.value || 6)));
    const fromMonth = shiftYearMonth(endMonth, -(count - 1));
    const button = $('kkAnalyticsTrendRefresh');
    trendLoading = true;
    if (button) button.disabled = true;
    const body = $('kkAnalyticsTrendBody');
    if (body) body.innerHTML = '<p>최근 월별 집계를 계산하고 있습니다.</p>';
    try {
      const params = new URLSearchParams({ campusId, fromYearMonth: fromMonth, toYearMonth: endMonth });
      const result = await core.api(`/api/kkumeum/analytics/trend?${params}`);
      renderTrend(result.trend);
    } catch (error) {
      if (body) body.innerHTML = `<p>${escapeHtml(error?.message || '최근 흐름을 불러오지 못했습니다.')}</p>`;
    } finally {
      trendLoading = false;
      if (button) button.disabled = false;
    }
  }

  async function loadAnalytics() {
    if (loading || !showForAccess()) return;
    const core = staff();
    const campusId = core?.state?.campusId || '';
    if (!campusId || !core?.state?.health?.ok) return;
    const month = $('kkAnalyticsMonth')?.value || localYearMonth();
    loading = true;
    if ($('kkAnalyticsRefresh')) $('kkAnalyticsRefresh').disabled = true;
    setFeedback('집계 통계를 계산하고 있습니다.');
    try {
      const params = new URLSearchParams({ campusId, yearMonth: month });
      const result = await core.api(`/api/kkumeum/analytics/preview?${params}`);
      const data = result.analytics;
      renderCards(data);
      renderBreakdown(data);
      renderGrowthSkills(data);
      trendNode();
      void loadTrend();
      const sync = $('kkAnalyticsSync');
      if (sync) {
        sync.hidden = !core.state.context?.isSuperAdmin;
        sync.disabled = !result.syncEnabled;
        sync.textContent = result.syncEnabled ? 'DATA CORE에 집계 저장' : '운영 승인 후 저장 가능';
      }
      setFeedback(`집계 기준 ${escapeHtml(data.yearMonth)} · 최소 집단 ${escapeHtml(data.minimumCohortSize)}명 · 학생 개인식별정보/평가본문/파일정보 미포함`);
      lastCampusId = campusId;
    } catch (error) {
      const cards = $('kkAnalyticsCards');
      if (cards) cards.replaceChildren();
      const breakdown = $('kkAnalyticsBreakdown');
      const growthSkills = $('kkAnalyticsGrowthSkills');
      const trend = $('kkAnalyticsTrendBody');
      if (breakdown) breakdown.replaceChildren();
      if (growthSkills) growthSkills.replaceChildren();
      if (trend) trend.replaceChildren();
      setFeedback(error?.message || '성장 통계를 불러오지 못했습니다.');
    } finally {
      loading = false;
      if ($('kkAnalyticsRefresh')) $('kkAnalyticsRefresh').disabled = false;
    }
  }

  async function syncAnalytics() {
    const core = staff();
    if (!core?.state?.context?.isSuperAdmin || !canPreview()) return;
    const button = $('kkAnalyticsSync');
    if (button?.disabled) return;
    button.disabled = true;
    setFeedback('서버에서 집계를 다시 계산해 DATA CORE에 저장하고 있습니다.');
    try {
      const result = await core.api('/api/kkumeum/analytics/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          campusId: core.state.campusId,
          yearMonth: $('kkAnalyticsMonth')?.value || localYearMonth(),
        }),
      });
      setFeedback(`집계 저장 완료 · ${escapeHtml(result.preview.yearMonth)} · 학생별 원본은 DATA CORE에 복사하지 않았습니다.`);
    } catch (error) {
      setFeedback(error?.status === 503 ? '성장 통계 DATA CORE 저장은 운영 승인 후 사용할 수 있습니다.' : (error?.message || '집계 저장을 완료하지 못했습니다.'));
    } finally {
      button.disabled = false;
    }
  }

  function initializeControls() {
    growthSkillsNode();
    trendNode();
    const month = $('kkAnalyticsMonth');
    if (month && !month.value) month.value = localYearMonth();
    if ($('kkAnalyticsRefresh')) $('kkAnalyticsRefresh').onclick = () => loadAnalytics();
    if ($('kkAnalyticsSync')) $('kkAnalyticsSync').onclick = () => syncAnalytics();
    if (month) month.onchange = () => loadAnalytics();
  }

  window.addEventListener('kkumeum:ready', () => {
    initializeControls();
    showForAccess();
    void loadAnalytics();
  });

  window.addEventListener('kkumeum:students-updated', () => {
    if (!staff()) return;
    showForAccess();
    const campusId = staff().state?.campusId || '';
    if (campusId && campusId !== lastCampusId) void loadAnalytics();
  });

  if (document.readyState !== 'loading') initializeControls();
  else document.addEventListener('DOMContentLoaded', initializeControls, { once: true });
})();
