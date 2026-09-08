(() => {
  const DEFAULT_FOLDERS = [
    { key: 'class-artwork', label: '수업그림', sortOrder: 10 },
    { key: 'director-only', label: '원장전용', sortOrder: 20 },
    { key: 'resources', label: '자료', sortOrder: 30 },
    { key: 'production', label: '제작물', sortOrder: 40 },
  ];
  const RECORD_TYPE = 'hq-library-folder';
  const SOURCE_APP = 'data-core-library';
  const UPLOAD_CATEGORY = 'counseling-material';
  const state = { context: null, folders: [], selectedId: '', files: [], ensuring: false };

  const h = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof body === 'object' && body?.error ? body.error : String(body || `HTTP ${response.status}`);
      throw new Error(message);
    }
    return body;
  }

  function isSuperAdmin() {
    return Boolean(state.context?.isSuperAdmin);
  }

  function folderMeta(folder) {
    return folder?.metadata && typeof folder.metadata === 'object' ? folder.metadata : {};
  }

  function normalizedFolders(records) {
    return (records || [])
      .filter((folder) => folder && folder.campusId == null && folder.recordType === RECORD_TYPE && folder.sourceApp === SOURCE_APP)
      .sort((a, b) => {
        const left = Number(folderMeta(a).sortOrder) || 9999;
        const right = Number(folderMeta(b).sortOrder) || 9999;
        return left - right || String(a.title || '').localeCompare(String(b.title || ''), 'ko');
      });
  }

  async function readFolders() {
    const response = await api(`/api/data-core/records?recordType=${encodeURIComponent(RECORD_TYPE)}&sourceApp=${encodeURIComponent(SOURCE_APP)}&limit=100`);
    return normalizedFolders(response.records || []);
  }

  async function ensureDefaultFolders() {
    if (!isSuperAdmin() || state.ensuring) return;
    state.ensuring = true;
    try {
      let folders = await readFolders();
      const keys = new Set(folders.map((folder) => String(folderMeta(folder).folderKey || '')));
      for (const item of DEFAULT_FOLDERS) {
        if (keys.has(item.key)) continue;
        await api('/api/data-core/records', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            campusId: null,
            recordType: RECORD_TYPE,
            sourceApp: SOURCE_APP,
            title: item.label,
            summary: '본원 공용 작업물 폴더',
            visibility: 'organization',
            metadata: { folderKey: item.key, sortOrder: item.sortOrder, system: true },
            tags: ['본원 작업물', 'hq-library-folder', `hq:${item.key}`],
          }),
        });
        keys.add(item.key);
      }
      folders = await readFolders();
      state.folders = folders;
    } finally {
      state.ensuring = false;
    }
  }

  async function loadFiles(folderId) {
    if (!folderId) {
      state.files = [];
      renderFiles();
      return;
    }
    const response = await api(`/api/data-core/files?recordId=${encodeURIComponent(folderId)}&limit=100`);
    state.files = response.files || [];
    renderFiles();
  }

  function renderFiles() {
    const root = document.getElementById('hqLibraryFiles');
    const title = document.getElementById('hqLibrarySelectedTitle');
    const upload = document.getElementById('hqLibraryUploadBtn');
    if (!root || !title) return;
    const selected = state.folders.find((folder) => String(folder.id) === String(state.selectedId));
    title.textContent = selected ? selected.title : '본원 폴더를 선택하세요';
    if (upload) upload.disabled = !selected;
    if (!selected) {
      root.innerHTML = '<div class="hq-library-empty">수업그림·원장전용·자료·제작물 중 하나를 선택하세요.</div>';
      return;
    }
    if (!state.files.length) {
      root.innerHTML = '<div class="hq-library-empty">이 폴더에 등록된 작업물이 없습니다.</div>';
      return;
    }
    root.innerHTML = state.files.map((file) => `<a class="hq-library-file" href="${h(file.downloadUrl || `/api/data-core/files/${encodeURIComponent(String(file.id))}`)}" target="_blank" rel="noopener">
      <span class="hq-library-file-icon">${String(file.mimeType || '').startsWith('image/') ? '▧' : '▤'}</span>
      <span><strong>${h(file.fileName || '파일')}</strong><small>${h(file.ownerName || '본원')} · ${h(new Date(file.createdAt).toLocaleDateString('ko-KR'))}</small></span>
    </a>`).join('');
  }

  function renderSection() {
    const host = document.getElementById('folderGroups');
    if (!host) return;
    let section = document.getElementById('hqLibrarySection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'hqLibrarySection';
      section.className = 'campus-folder-section hq-library-section';
      host.prepend(section);
    }
    const buttons = state.folders.length
      ? state.folders.map((folder) => `<button class="folder-chip ${String(folder.id) === String(state.selectedId) ? 'active' : ''}" data-hq-folder-id="${h(folder.id)}" aria-pressed="${String(folder.id) === String(state.selectedId) ? 'true' : 'false'}"><span>▣</span><strong>${h(folder.title)}</strong></button>`).join('')
      : DEFAULT_FOLDERS.map((folder) => `<button class="folder-chip" disabled><span>▣</span><strong>${h(folder.label)}</strong></button>`).join('');
    section.innerHTML = `
      <div class="hq-library-heading">
        <div><h4>본원 작업물</h4><small>본원에서 올린 공용 작업물을 모든 캠퍼스가 함께 사용합니다.</small></div>
        ${isSuperAdmin() ? '<button class="ghost-btn hq-library-add" id="hqLibraryAddFolderBtn" type="button">+ 폴더 추가</button>' : ''}
      </div>
      <div class="folder-chip-grid hq-library-folder-grid">${buttons}</div>
      <div class="hq-library-browser">
        <div class="hq-library-browser-head">
          <strong id="hqLibrarySelectedTitle">본원 폴더를 선택하세요</strong>
          ${isSuperAdmin() ? '<button class="secondary-btn" id="hqLibraryUploadBtn" type="button" disabled>파일 업로드</button><input id="hqLibraryFileInput" type="file" multiple hidden>' : ''}
        </div>
        <div class="hq-library-files" id="hqLibraryFiles"></div>
      </div>`;

    section.querySelectorAll('[data-hq-folder-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.selectedId = button.dataset.hqFolderId || '';
        renderSection();
        await loadFiles(state.selectedId);
      });
    });
    section.querySelector('#hqLibraryAddFolderBtn')?.addEventListener('click', createFolder);
    const uploadButton = section.querySelector('#hqLibraryUploadBtn');
    const input = section.querySelector('#hqLibraryFileInput');
    uploadButton?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length || !state.selectedId) return;
      uploadButton.disabled = true;
      uploadButton.textContent = '업로드 중...';
      try {
        for (const file of files) {
          const form = new FormData();
          form.append('file', file);
          form.append('campusId', '');
          form.append('category', UPLOAD_CATEGORY);
          form.append('sourceApp', 'hq-library');
          form.append('recordId', state.selectedId);
          form.append('ownerId', 'shared');
          form.append('year', String(new Date().getFullYear()));
          await api('/api/data-core/files', { method: 'POST', body: form });
        }
        await loadFiles(state.selectedId);
      } catch (error) {
        window.alert(`본원 작업물 업로드에 실패했습니다: ${error.message}`);
      } finally {
        input.value = '';
        uploadButton.disabled = false;
        uploadButton.textContent = '파일 업로드';
      }
    });
    renderFiles();
  }

  async function createFolder() {
    if (!isSuperAdmin()) return;
    const title = window.prompt('새 본원 작업물 폴더 이름을 입력하세요.');
    if (!title?.trim()) return;
    const sortOrder = Math.max(1000, ...state.folders.map((folder) => Number(folderMeta(folder).sortOrder) || 0)) + 10;
    await api('/api/data-core/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        campusId: null,
        recordType: RECORD_TYPE,
        sourceApp: SOURCE_APP,
        title: title.trim().slice(0, 80),
        summary: '본원 공용 작업물 폴더',
        visibility: 'organization',
        metadata: { folderKey: `custom-${Date.now()}`, sortOrder, system: false },
        tags: ['본원 작업물', 'hq-library-folder'],
      }),
    });
    await refresh();
  }

  function addStyle() {
    if (document.getElementById('hq-library-style')) return;
    const style = document.createElement('style');
    style.id = 'hq-library-style';
    style.textContent = `
      .hq-library-section{margin-bottom:22px;padding-bottom:22px;border-bottom:1px solid var(--line,#e5e7eb)}
      .hq-library-heading,.hq-library-browser-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
      .hq-library-heading h4{margin:0 0 4px}.hq-library-heading small{color:var(--muted,#667085)}
      .hq-library-folder-grid{margin-top:14px}.hq-library-browser{margin-top:16px;padding:14px;border:1px solid var(--line,#e5e7eb);border-radius:14px;background:rgba(255,255,255,.7)}
      .hq-library-files{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:12px}
      .hq-library-file{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--line,#e5e7eb);border-radius:12px;text-decoration:none;color:inherit;background:#fff}
      .hq-library-file:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(15,23,42,.06)}
      .hq-library-file span:last-child{min-width:0}.hq-library-file strong,.hq-library-file small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hq-library-file small{margin-top:3px;color:var(--muted,#667085);font-size:12px}
      .hq-library-file-icon{font-size:20px}.hq-library-empty{padding:18px;text-align:center;color:var(--muted,#667085)}
      @media(max-width:720px){.hq-library-heading,.hq-library-browser-head{align-items:flex-start;flex-direction:column}.hq-library-files{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  async function refresh() {
    if (!state.context?.authenticated) return;
    state.folders = await readFolders();
    await ensureDefaultFolders();
    if (!state.folders.length) state.folders = await readFolders();
    if (state.selectedId && !state.folders.some((folder) => String(folder.id) === String(state.selectedId))) state.selectedId = '';
    renderSection();
    if (state.selectedId) await loadFiles(state.selectedId);
  }

  async function init() {
    const host = document.getElementById('folderGroups');
    if (!host) return;
    addStyle();
    try {
      state.context = await api('/api/data-core/context');
      if (!state.context?.authenticated) return;
      await refresh();
      const observer = new MutationObserver(() => {
        if (!document.getElementById('hqLibrarySection')) queueMicrotask(renderSection);
      });
      observer.observe(host, { childList: true });
    } catch (error) {
      console.warn('본원 작업물 영역을 불러오지 못했습니다.', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
