(() => {
  async function syncAdminNavigation() {
    const adminLinks = Array.from(document.querySelectorAll('[data-super-admin-nav]'));
    if (!adminLinks.length) return;

    adminLinks.forEach((link) => link.classList.add('hidden'));
    try {
      const response = await fetch('/api/data-core/context', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!response.ok) return;
      const context = await response.json();
      const visible = Boolean(context?.authenticated && context?.isSuperAdmin);
      adminLinks.forEach((link) => link.classList.toggle('hidden', !visible));
    } catch {
      adminLinks.forEach((link) => link.classList.add('hidden'));
    }
  }

  function installContentDraftEnhancements() {
    const form = document.getElementById('draftForm');
    const tagsInput = document.getElementById('draftTags');
    const publishStatus = document.getElementById('publishStatus');
    const selectedFiles = document.querySelector('.selected-files');
    if (!form || !tagsInput || !publishStatus || !selectedFiles) return;
    if (document.getElementById('draftCta')) return;

    const ctaLabel = document.createElement('label');
    ctaLabel.innerHTML = '<span>CTA</span><input id="draftCta" placeholder="예: 상담 예약은 캠퍼스로 문의해 주세요.">';
    publishStatus.closest('label')?.before(ctaLabel);

    const preview = document.createElement('section');
    preview.className = 'draft-preview';
    preview.setAttribute('aria-labelledby', 'previewTitle');
    preview.innerHTML = `
      <div class="draft-preview-head">
        <strong id="previewTitle">미리보기</strong>
        <span id="previewSource">블로그 초안</span>
      </div>
      <strong id="previewDraftTitle">제목을 입력하면 미리보기에 표시됩니다.</strong>
      <p id="previewDraftSummary">주제와 본문, 키워드, CTA를 확인한 뒤 같은 화면에서 수정할 수 있습니다.</p>
      <p class="preview-content" id="previewDraftContent"></p>
      <div class="preview-tags" id="previewDraftTags"></div>
      <p class="preview-cta" id="previewDraftCta"></p>`;
    selectedFiles.after(preview);

    const style = document.createElement('style');
    style.textContent = `
      .draft-preview{border:1px solid var(--line);border-radius:12px;padding:16px;background:#fff;display:grid;gap:9px}
      .draft-preview-head{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px}
      .draft-preview>strong{font-size:16px;color:var(--text)}
      .draft-preview p{margin:0;color:var(--muted);font-size:12px;line-height:1.65;white-space:pre-wrap}
      .draft-preview .preview-content{color:var(--text)}
      .preview-tags{display:flex;flex-wrap:wrap;gap:6px}
      .preview-tags:empty{display:none}
      .preview-tags span{background:var(--surface-soft);border-radius:999px;color:var(--muted);font-size:10px;padding:5px 8px}
      .draft-preview .preview-cta{color:var(--primary-dark);font-weight:800}`;
    document.head.appendChild(style);

    const text = (id) => document.getElementById(id)?.value?.trim() || '';
    const currentSource = () => {
      const active = document.querySelector('[data-source-tab].active');
      return active?.dataset?.sourceTab === 'instagram' ? 'instagram' : 'blog';
    };

    function renderDraftPreview() {
      const source = currentSource();
      const title = text('draftTitle');
      const summary = text('draftSummary');
      const content = text('draftContent');
      const cta = text('draftCta');
      const tags = text('draftTags').split(',').map((item) => item.trim()).filter(Boolean);
      const sourceEl = document.getElementById('previewSource');
      const titleEl = document.getElementById('previewDraftTitle');
      const summaryEl = document.getElementById('previewDraftSummary');
      const contentEl = document.getElementById('previewDraftContent');
      const tagsEl = document.getElementById('previewDraftTags');
      const ctaEl = document.getElementById('previewDraftCta');
      if (!sourceEl || !titleEl || !summaryEl || !contentEl || !tagsEl || !ctaEl) return;

      sourceEl.textContent = source === 'instagram' ? '인스타 2160 × 2700px · 4:5' : '블로그 초안';
      titleEl.textContent = title || '제목을 입력하면 미리보기에 표시됩니다.';
      summaryEl.textContent = summary || '주제와 본문, 키워드, CTA를 확인한 뒤 같은 화면에서 수정할 수 있습니다.';
      contentEl.textContent = content;
      tagsEl.replaceChildren(...tags.map((tag) => {
        const pill = document.createElement('span');
        pill.textContent = `#${tag}`;
        return pill;
      }));
      ctaEl.textContent = cta ? `CTA · ${cta}` : '';
    }

    const originalDraftPayload = window.draftPayload;
    if (typeof originalDraftPayload === 'function') {
      window.draftPayload = function enhancedDraftPayload(...args) {
        const payload = originalDraftPayload.apply(this, args);
        const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? payload.metadata
          : {};
        return {
          ...payload,
          metadata: {
            ...metadata,
            callToAction: text('draftCta') || null,
          },
        };
      };
    }

    const originalLoadDraftIntoForm = window.loadDraftIntoForm;
    if (typeof originalLoadDraftIntoForm === 'function') {
      window.loadDraftIntoForm = function enhancedLoadDraftIntoForm(draft, ...args) {
        const result = originalLoadDraftIntoForm.call(this, draft, ...args);
        const metadata = draft?.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};
        const input = document.getElementById('draftCta');
        if (input) input.value = metadata.callToAction || '';
        renderDraftPreview();
        return result;
      };
    }

    const originalResetDraftForm = window.resetDraftForm;
    if (typeof originalResetDraftForm === 'function') {
      window.resetDraftForm = function enhancedResetDraftForm(...args) {
        const result = originalResetDraftForm.apply(this, args);
        const input = document.getElementById('draftCta');
        if (input) input.value = '';
        renderDraftPreview();
        return result;
      };
    }

    const originalSetSourceApp = window.setSourceApp;
    if (typeof originalSetSourceApp === 'function') {
      window.setSourceApp = function enhancedSetSourceApp(...args) {
        const result = originalSetSourceApp.apply(this, args);
        queueMicrotask(renderDraftPreview);
        return result;
      };
    }

    ['draftTitle', 'draftSummary', 'draftContent', 'draftTags', 'draftCta'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', renderDraftPreview);
    });
    document.querySelectorAll('[data-source-tab]').forEach((button) => {
      button.addEventListener('click', () => queueMicrotask(renderDraftPreview));
    });

    window.renderDraftPreview = renderDraftPreview;
    renderDraftPreview();
  }

  syncAdminNavigation();
  installContentDraftEnhancements();
})();
