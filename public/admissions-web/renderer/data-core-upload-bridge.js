(function () {
  const nativeFetch = window.fetch.bind(window);
  const CONTEXT_URL = '/api/data-core/context';
  const DATA_CORE_UPLOAD_URL = '/api/data-core/upload';
  const CONTEXT_TTL_MS = 60 * 1000;

  let contextCache = null;
  let contextFetchedAt = 0;
  let contextPromise = null;

  function requestPath(input) {
    try {
      const value = typeof input === 'string' ? input : input?.url;
      return new URL(String(value || ''), window.location.origin).pathname;
    } catch (_) {
      return '';
    }
  }

  function areaForPurpose(purpose) {
    if (purpose === 'student-artwork') return 'student-private';
    if (purpose === 'admission-images' || purpose === 'award-images') return 'academy-public';
    return 'documents-private';
  }

  async function dataCoreContext() {
    if (contextCache && Date.now() - contextFetchedAt < CONTEXT_TTL_MS) return contextCache;
    if (contextPromise) return contextPromise;

    contextPromise = nativeFetch(CONTEXT_URL, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const value = await response.json();
        contextCache = value && typeof value === 'object' ? value : null;
        contextFetchedAt = Date.now();
        return contextCache;
      })
      .catch(() => null)
      .finally(() => {
        contextPromise = null;
      });

    return contextPromise;
  }

  function resolvedCampusId(context, body) {
    const explicit = String(body.get('campusId') || '').trim();
    if (explicit) return explicit;
    const ids = Array.isArray(context?.campusIds) ? context.campusIds.filter(Boolean) : [];
    return ids.length === 1 ? String(ids[0]) : '';
  }

  function canUseDataCore(context, campusId) {
    if (!context?.authenticated || !context?.canWrite) return false;
    if (context.isSuperAdmin) return true;
    return Boolean(campusId);
  }

  function copyFormData(source) {
    const target = new FormData();
    for (const [key, value] of source.entries()) target.append(key, value);
    return target;
  }

  function legacyUploadShape(file, uploaded) {
    const url = uploaded.downloadUrl;
    return {
      id: Date.now(),
      dataCoreFileId: uploaded.id,
      metadataStored: true,
      area: uploaded.area,
      key: '',
      url,
      imageUrl: url,
      filePath: url,
      path: url,
      fileName: uploaded.fileName || file?.name || 'image',
      name: uploaded.fileName || file?.name || 'image',
      contentType: uploaded.mimeType || file?.type || 'application/octet-stream',
      createdAt: uploaded.createdAt || new Date().toISOString(),
      dataCore: true,
      campusId: uploaded.campusId || null,
    };
  }

  async function tryDataCoreUpload(input, init) {
    const body = init?.body;
    if (!(body instanceof FormData)) return null;

    const context = await dataCoreContext();
    const campusId = resolvedCampusId(context, body);
    if (!canUseDataCore(context, campusId)) return null;

    const form = copyFormData(body);
    const purpose = String(form.get('purpose') || 'image').trim() || 'image';
    form.set('area', areaForPurpose(purpose));
    form.set('category', purpose);
    form.set('sourceApp', 'admissions');
    if (campusId) form.set('campusId', campusId);

    const response = await nativeFetch(DATA_CORE_UPLOAD_URL, {
      ...init,
      method: 'POST',
      body: form,
    });
    if (!response.ok) return null;

    try {
      const payload = await response.clone().json();
      const uploaded = payload?.file;
      const sourceFile = form.get('file');
      if (!uploaded?.id || !uploaded?.downloadUrl) return response;
      const result=legacyUploadShape(sourceFile,uploaded);
      if(purpose==='student-artwork' && /^image\/(jpeg|png|webp)$/.test(sourceFile?.type||'')) {
        result.thumbnailGenerationStatus='pending';
        try {
          await window.DataCoreLibraryThumbnail.create(sourceFile,uploaded.id,init?.signal||new AbortController().signal,`/api/admissions/files/${encodeURIComponent(uploaded.id)}/thumbnail`);
          result.thumbnailGenerationStatus='ready';
        }catch{result.thumbnailGenerationStatus='failed';}
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    } catch (_) {
      return response;
    }
  }

  window.fetch = async function dataCoreAwareFetch(input, init = {}) {
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    if (method === 'POST' && requestPath(input) === '/api/upload') {
      try {
        const bridged = await tryDataCoreUpload(input, init);
        if (bridged) return bridged;
      } catch (_) {
        // DATA CORE 전환 중 오류가 있어도 기존 입시컨설팅 업로드는 유지한다.
      }
    }
    return nativeFetch(input, init);
  };

  window.__DATA_CORE_UPLOAD_BRIDGE__ = {
    enabled: true,
    refreshContext() {
      contextCache = null;
      contextFetchedAt = 0;
    },
  };
}());
