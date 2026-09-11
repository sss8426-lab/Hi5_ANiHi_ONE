(function () {
  const SERVER_DATA_URL = '/api/data';
  const SERVER_UPLOAD_URL = '/api/upload';
  let nextIdBase = 0;
  function dataUrl() {
    const campus = new URL(location.href).searchParams.get('campusId');
    return SERVER_DATA_URL + (campus ? `?campusId=${encodeURIComponent(campus)}` : '');
  }
  const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
  const LEGACY_IMAGE_KEYS = new Set([
    'path',
    'url',
    'filePath',
    'imageUrl',
    'artworkImage',
    'artwork',
    'image',
    'thumbnail',
    'preview',
    'src',
  ]);


  function normalizeData(data) {
    const normalized = data && typeof data === 'object' ? data : {};
    normalized.version = normalized.version || 1;
    normalized.settings = normalized.settings || {};
    normalized.universities = Array.isArray(normalized.universities) ? normalized.universities : [];
    normalized.students = Array.isArray(normalized.students) ? normalized.students : [];
    normalized.cases = Array.isArray(normalized.cases) ? normalized.cases : [];
    normalized.awardFolders = Array.isArray(normalized.awardFolders) ? normalized.awardFolders : [];
    normalized.changeLogs = Array.isArray(normalized.changeLogs) ? normalized.changeLogs : [];
    normalized.admissionGradeRules = Array.isArray(normalized.admissionGradeRules) ? normalized.admissionGradeRules : [];
    return normalized;
  }


  async function readData() {
    const response = await fetch(dataUrl(), { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { location.assign('/data-core/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash)); throw new Error('로그인이 필요합니다.'); }
    if (!response.ok) throw new Error('입시 데이터를 불러오지 못했습니다. 로그인과 연결 상태를 확인하세요.');
    const data = normalizeData(await response.json());
    nextIdBase = data._campus?.nextIdBase || 0;
    return data;
  }

  async function writeData(data) {
      const response = await fetch(dataUrl(), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(normalizeData(structuredClone(data))),
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || '저장하지 못했습니다.'); }
      return data;
  }

  function nextId(items) {
    return (items || []).reduce((max, item) => Math.max(max, Number(item?.id) || 0), nextIdBase) + 1;
  }

  function downloadFile(fileName, contents, type = 'application/json') {
    const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function pickFiles(accept, multiple = false) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      }, { once: true });
      input.click();
    });
  }

  function pickDirectory() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPT;
      input.webkitdirectory = true;
      input.directory = true;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []).filter((file) => {
          const name = String(file.webkitRelativePath || file.name || '');
          return IMAGE_EXT_RE.test(name) || String(file.type || '').startsWith('image/');
        });
        input.remove();
        resolve(files);
      }, { once: true });
      input.click();
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file, meta = {}) {
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('purpose', meta.purpose || 'image');
      form.append('ownerId', meta.ownerId || 'common');
      if (meta.year) form.append('year', meta.year);
      const response = await fetch(SERVER_UPLOAD_URL, { method: 'POST', body: form });
      if (response.ok) return response.json();
    } catch (_) {}
    return null;
  }

  function isRemoteImageRef(value) {
    return /^(data:|blob:|https?:\/\/|\/api\/files\/)/i.test(String(value || ''));
  }

  function isLegacyLocalImageRef(value) {
    const source = String(value || '').trim();
    if (!source || isRemoteImageRef(source) || !IMAGE_EXT_RE.test(source.split(/[?#]/)[0])) return false;
    return /^file:\/\//i.test(source)
      || /^[a-z]:[\\/]/i.test(source)
      || /admissions-consulting-desktop[\\/]/i.test(source)
      || /(^|\\)(artworks|admission-images)(\\|$)/i.test(source.replace(/\//g, '\\'));
  }

  function imageSrcForViewer(value) {
    const source = String(value || '').trim();
    if (!source || isLegacyLocalImageRef(source)) return '';
    if (/^\/api\/files\//i.test(source)) return `${window.location.origin}${source}`;
    return source;
  }

  function legacyBaseName(value) {
    let source = String(value || '').trim();
    if (!source) return '';
    try {
      if (/^file:\/\//i.test(source)) {
        source = decodeURIComponent(source.replace(/^file:\/\/\/?/i, ''));
      } else {
        source = decodeURIComponent(source);
      }
    } catch (_) {}
    source = source.split(/[?#]/)[0].replace(/\\/g, '/');
    return source.split('/').filter(Boolean).pop() || '';
  }

  function normalizeFileName(value) {
    return legacyBaseName(value).normalize('NFC').toLowerCase();
  }

  function postMigrationProgress(detail) {
    window.dispatchEvent(new CustomEvent('legacy-image-migration-progress', { detail }));
  }

  function buildDirectoryFileIndex(files) {
    const byName = new Map();
    files.forEach((file) => {
      const names = [
        file.name,
        legacyBaseName(file.webkitRelativePath || ''),
      ].filter(Boolean);
      names.forEach((name) => {
        const key = normalizeFileName(name);
        if (!key || !IMAGE_EXT_RE.test(key)) return;
        if (!byName.has(key)) byName.set(key, file);
      });
    });
    return byName;
  }

  function getUploadMeta(path, ctx) {
    const source = String(path || '').replace(/\//g, '\\');
    if (ctx?.section === 'award') return { purpose: 'award-images', ownerId: ctx.ownerId || 'award', year: ctx.year };
    if (ctx?.section === 'university' || /(^|\\)admission-images(\\|$)/i.test(source)) return { purpose: 'admission-images', ownerId: ctx?.ownerId || 'university' };
    if (ctx?.section === 'student' || /(^|\\)artworks(\\|$)/i.test(source)) return { purpose: 'student-artwork', ownerId: ctx?.ownerId || 'student' };
    return { purpose: 'legacy-image', ownerId: ctx?.ownerId || 'legacy' };
  }

  function replaceImageFieldsInObject(item, filesByName, uploadCache, stats, ctx) {
    if (!item || typeof item !== 'object') return [];
    const jobs = [];
    Object.keys(item).forEach((key) => {
      const value = item[key];
      if (typeof value === 'string' && LEGACY_IMAGE_KEYS.has(key) && isLegacyLocalImageRef(value)) {
        stats.totalRefs += 1;
        const fileName = normalizeFileName(value);
        const file = filesByName.get(fileName);
        if (!file) {
          stats.missing += 1;
          return;
        }
        jobs.push(async () => {
          let uploaded = uploadCache.get(fileName);
          if (uploaded) {
            stats.reused += 1;
          } else {
            uploaded = await uploadImage(file, getUploadMeta(value, ctx));
            if (!uploaded?.url) throw new Error(`${file.name} 업로드에 실패했습니다.`);
            uploadCache.set(fileName, uploaded);
            stats.uploaded += 1;
            postMigrationProgress({ status: 'uploading', uploaded: stats.uploaded, updated: stats.updated, totalRefs: stats.totalRefs, fileName: file.name });
          }
          item[key] = uploaded.url;
          if (!item.fileName && uploaded.fileName) item.fileName = uploaded.fileName;
          if (!item.name && uploaded.name) item.name = uploaded.name;
          stats.updated += 1;
        });
      }
    });
    return jobs;
  }

  function replaceImageStringsInArray(list, filesByName, uploadCache, stats, ctx) {
    const jobs = [];
    if (!Array.isArray(list)) return jobs;
    list.forEach((value, index) => {
      if (typeof value !== 'string' || !isLegacyLocalImageRef(value)) return;
      stats.totalRefs += 1;
      const fileName = normalizeFileName(value);
      const file = filesByName.get(fileName);
      if (!file) {
        stats.missing += 1;
        return;
      }
      jobs.push(async () => {
        let uploaded = uploadCache.get(fileName);
        if (uploaded) {
          stats.reused += 1;
        } else {
          uploaded = await uploadImage(file, getUploadMeta(value, ctx));
          if (!uploaded?.url) throw new Error(`${file.name} 업로드에 실패했습니다.`);
          uploadCache.set(fileName, uploaded);
          stats.uploaded += 1;
          postMigrationProgress({ status: 'uploading', uploaded: stats.uploaded, updated: stats.updated, totalRefs: stats.totalRefs, fileName: file.name });
        }
        list[index] = uploaded.url;
        stats.updated += 1;
      });
    });
    return jobs;
  }

  function collectLegacyImageJobs(data, filesByName, uploadCache, stats) {
    const jobs = [];
    const visitUnknown = (value, ctx) => {
      if (Array.isArray(value)) {
        jobs.push(...replaceImageStringsInArray(value, filesByName, uploadCache, stats, ctx));
        value.forEach((entry) => visitUnknown(entry, ctx));
        return;
      }
      if (!value || typeof value !== 'object') return;
      jobs.push(...replaceImageFieldsInObject(value, filesByName, uploadCache, stats, ctx));
      Object.entries(value).forEach(([key, child]) => {
        if (LEGACY_IMAGE_KEYS.has(key)) return;
        visitUnknown(child, ctx);
      });
    };

    (data.students || []).forEach((student) => {
      const ctx = { section: 'student', ownerId: student.id || 'student' };
      jobs.push(...replaceImageFieldsInObject(student, filesByName, uploadCache, stats, ctx));
      visitUnknown(student.artworks, ctx);
      visitUnknown(student.admissionResults, ctx);
    });

    (data.cases || []).forEach((caseItem) => {
      const ctx = { section: 'student', ownerId: caseItem.id || 'case' };
      jobs.push(...replaceImageFieldsInObject(caseItem, filesByName, uploadCache, stats, ctx));
      visitUnknown(caseItem.artworks, ctx);
    });

    (data.universities || []).forEach((university) => {
      const ctx = { section: 'university', ownerId: university.id || 'university' };
      visitUnknown(university.admissionImages, ctx);
    });

    (data.awardFolders || []).forEach((folder) => {
      Object.entries(folder.years || {}).forEach(([year, images]) => {
        visitUnknown(images, { section: 'award', ownerId: folder.id || 'award', year });
      });
    });

    return jobs;
  }

  async function filesToImages(files, meta = {}, idFactory) {
    const now = Date.now();
    return Promise.all(files.map(async (file, index) => {
      const uploaded = await uploadImage(file, meta);
      if (uploaded) return uploaded;
      const dataUrl = await fileToDataUrl(file);
      const id = idFactory ? idFactory(index, file) : now + index;
      return {
        id,
        filePath: dataUrl,
        path: dataUrl,
        imageUrl: dataUrl,
        url: dataUrl,
        fileName: file.name,
        name: file.name,
        createdAt: new Date().toISOString(),
      };
    }));
  }

  function parseJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result || '{}')));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'utf-8');
    });
  }

  function normalizeImportItems(parsed, key) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed[key])) return parsed[key];
    throw new Error('가져올 수 있는 데이터 파일이 아닙니다.');
  }

  function updateChangeLog(data, entry) {
    data.changeLogs = Array.isArray(data.changeLogs) ? data.changeLogs : [];
    data.changeLogs.unshift({
      id: Date.now(),
      changedAt: new Date().toISOString(),
      ...entry,
    });
  }

  function getUniversity(data, universityId) {
    const university = data.universities.find((item) => Number(item.id) === Number(universityId));
    if (!university) throw new Error('대학 정보를 찾을 수 없습니다.');
    return university;
  }

  function imageRecordsForViewer(university) {
    return (Array.isArray(university.admissionImages) ? university.admissionImages : [])
      .filter((image) => image?.imageUrl || image?.url || image?.filePath || image?.path)
      .map((image) => ({
        id: image.id,
        fileName: image.fileName || image.name || '입시요강 이미지',
        url: image.imageUrl || image.url || image.filePath || image.path,
      }));
  }

  function openImageViewer(universityId, universityName, images) {
    const viewer = window.open('', '_blank', 'width=1280,height=860');
    if (!viewer) throw new Error('새 창이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
    const title = `${universityName || '대학'} 입시요강 이미지`;
    viewer.document.write(`<!doctype html>
      <html lang="ko">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <base href="${escapeAttr(window.location.origin)}/">
        <style>
          *{box-sizing:border-box}
          body{margin:0;background:#f2f5fa;color:#0f172a;font-family:"Malgun Gothic","Segoe UI",sans-serif}
          .viewer{height:100vh;display:grid;grid-template-columns:minmax(210px,300px) 1fr}
          .thumbs{background:#fff;border-right:1px solid #dbe3ef;padding:16px;overflow:auto}
          .thumb{width:100%;border:1px solid #d6dfeb;background:#fff;border-radius:8px;padding:8px;margin:0 0 12px;cursor:pointer;text-align:left}
          .thumb.active{border-color:#2563eb;background:#eff6ff}
          .thumb img{display:block;width:100%;height:150px;object-fit:cover;border-radius:6px;background:#e5eaf2}
          .thumb span{display:block;margin-top:8px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .stage{min-width:0;display:grid;grid-template-rows:70px 1fr}
          .bar{background:#fff;border-bottom:1px solid #dbe3ef;display:flex;align-items:center;justify-content:space-between;padding:0 24px;gap:14px}
          .title{font-size:22px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .delete{border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:8px;padding:12px 18px;font-size:16px;cursor:pointer}
          .image-wrap{min-height:0;overflow:auto;padding:22px;display:flex;align-items:center;justify-content:center}
          .image-wrap img{max-width:100%;max-height:100%;object-fit:contain;background:#fff;border-radius:8px;box-shadow:0 8px 28px rgba(15,23,42,.14)}
          .missing{width:min(760px,90%);background:#fff;border:1px solid #dbe3ef;border-radius:10px;padding:28px;color:#475569;font-size:17px;line-height:1.7;text-align:center}
          .thumb .missing{width:100%;height:150px;padding:0;display:grid;place-items:center;font-size:13px}
          .empty{height:100vh;display:grid;place-items:center;color:#64748b;font-size:18px}
        </style>
      </head>
      <body><div id="root"></div></body>
      </html>`);
    viewer.document.close();
    viewer.__admissionImages = structuredClone(images);
    viewer.__selectedImageId = images[0]?.id || null;
    viewer.__deleteAdmissionImage = async () => {
      const selectedId = viewer.__selectedImageId;
      if (!selectedId || !viewer.confirm('선택한 입시요강 이미지를 삭제할까요?')) return;
      const result = await window.desktopAPI.deleteAdmissionImage(universityId, selectedId);
      viewer.__admissionImages = result.images || [];
      viewer.__selectedImageId = viewer.__admissionImages[0]?.id || null;
      renderViewer();
    };
    function renderViewer() {
      const root = viewer.document.getElementById('root');
      const currentImages = viewer.__admissionImages || [];
      const selected = currentImages.find((image) => image.id === viewer.__selectedImageId) || currentImages[0];
      if (!selected) {
        root.innerHTML = '<div class="empty">저장된 입시요강 이미지가 없습니다.</div>';
        return;
      }
      viewer.__selectedImageId = selected.id;
      const selectedSrc = imageSrcForViewer(selected.url);
      root.innerHTML = `<div class="viewer"><aside class="thumbs">${currentImages.map((image) => `
        <button class="thumb ${image.id === selected.id ? 'active' : ''}" data-id="${String(image.id)}">
          ${imageSrcForViewer(image.url) ? `<img src="${escapeAttr(imageSrcForViewer(image.url))}" alt="" loading="lazy" decoding="async">` : '<div class="missing">이전 필요</div>'}
          <span>${escapeHtml(image.fileName)}</span>
        </button>`).join('')}</aside>
        <section class="stage">
          <div class="bar"><div class="title">${escapeHtml(selected.fileName)}</div><button class="delete" id="deleteImageBtn" type="button">이미지 삭제</button></div>
          <div class="image-wrap">${selectedSrc ? `<img src="${escapeAttr(selectedSrc)}" alt="" decoding="async">` : '<div class="missing">이 이미지는 아직 기존 PC 경로로 연결되어 있습니다.<br>설정 / 백업에서 기존 그림 폴더를 선택해 웹 저장소로 이전해주세요.</div>'}</div>
        </section></div>`;
      viewer.document.querySelectorAll('.thumb').forEach((button) => {
        button.onclick = () => {
          viewer.__selectedImageId = button.dataset.id;
          renderViewer();
        };
      });
      viewer.document.getElementById('deleteImageBtn').onclick = viewer.__deleteAdmissionImage;
    }
    renderViewer();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  window.desktopAPI = {
    async getAll() {
      return readData();
    },

    async addStudent(student) {
      const data = await readData();
      const item = { ...student, id: nextId(data.students), createdAt: new Date().toISOString() };
      data.students.push(item);
      await writeData(data);
      return item;
    },

    async updateStudent(student) {
      const data = await readData();
      const index = data.students.findIndex((item) => Number(item.id) === Number(student.id));
      if (index < 0) throw new Error('학생 정보를 찾을 수 없습니다.');
      data.students[index] = { ...data.students[index], ...student, updatedAt: new Date().toISOString() };
      await writeData(data);
      return data.students[index];
    },

    async deleteStudent(studentId) {
      const data = await readData();
      const index = data.students.findIndex((item) => Number(item.id) === Number(studentId));
      if (index < 0) throw new Error('학생 정보를 찾을 수 없습니다.');
      const removed = data.students.splice(index, 1)[0];
      await writeData(data);
      return removed;
    },

    async importStudentArtwork() {
      const files = await pickFiles(IMAGE_ACCEPT, true);
      if (!files.length) return { ok: false };
      const images = await filesToImages(files, { purpose: 'student-artwork', ownerId: 'student' });
      return { ok: true, files: images, path: images[0]?.path, url: images[0]?.url };
    },

    async addAwardFolder(universityName) {
      const name = String(universityName || '').trim();
      if (!name) throw new Error('대학명을 입력하세요.');
      const data = await readData();
      const folder = { id: nextId(data.awardFolders), universityName: name, years: {}, createdAt: new Date().toISOString() };
      data.awardFolders.push(folder);
      await writeData(data);
      return folder;
    },

    async importAwardImages(folderId, year) {
      const files = await pickFiles(IMAGE_ACCEPT, true);
      if (!files.length) return { ok: false };
      const data = await readData();
      const folder = data.awardFolders.find((item) => Number(item.id) === Number(folderId));
      if (!folder) throw new Error('수상작 폴더를 찾을 수 없습니다.');
      const yearKey = String(year || new Date().getFullYear());
      folder.years = folder.years || {};
      const existing = Array.isArray(folder.years[yearKey]) ? folder.years[yearKey] : [];
      let imageId = nextId(existing);
      const images = await filesToImages(files, { purpose: 'award-images', ownerId: folder.id, year: yearKey }, () => imageId++);
      folder.years[yearKey] = existing.concat(images);
      await writeData(data);
      return { ok: true, folder, images };
    },

    async deleteAwardImage(folderId, year, imageId) {
      const data = await readData();
      const folder = data.awardFolders.find((item) => Number(item.id) === Number(folderId));
      if (!folder) throw new Error('수상작 폴더를 찾을 수 없습니다.');
      const yearKey = String(year || '');
      const list = Array.isArray(folder.years?.[yearKey]) ? folder.years[yearKey] : [];
      folder.years = folder.years || {};
      folder.years[yearKey] = list.filter((image) => String(image.id) !== String(imageId));
      await writeData(data);
      return { ok: true, folder };
    },

    async saveAdmissionImages(universityId) {
      const files = await pickFiles(IMAGE_ACCEPT, true);
      if (!files.length) return { ok: false };
      const data = await readData();
      const university = getUniversity(data, universityId);
      const images = await filesToImages(files, { purpose: 'admission-images', ownerId: university.id });
      university.admissionImages = [...(Array.isArray(university.admissionImages) ? university.admissionImages : []), ...images];
      updateChangeLog(data, {
        type: 'university-admission-images',
        universityId: university.id,
        universityName: university.name,
        before: null,
        after: { count: images.length },
      });
      await writeData(data);
      return { ok: true, university, images };
    },

    async openAdmissionImages(universityId) {
      const data = await readData();
      const university = getUniversity(data, universityId);
      const images = imageRecordsForViewer(university);
      if (!images.length) throw new Error('저장된 입시요강 이미지가 없습니다.');
      openImageViewer(university.id, university.name, images);
      return { ok: true, count: images.length };
    },

    async deleteAdmissionImage(universityId, imageId) {
      const data = await readData();
      const university = getUniversity(data, universityId);
      const images = Array.isArray(university.admissionImages) ? university.admissionImages : [];
      const target = images.find((image) => String(image.id) === String(imageId));
      if (!target) throw new Error('삭제할 이미지를 찾을 수 없습니다.');
      university.admissionImages = images.filter((image) => String(image.id) !== String(imageId));
      updateChangeLog(data, {
        type: 'university-admission-image-delete',
        universityId: university.id,
        universityName: university.name,
        before: { imageId, fileName: target.fileName || target.name },
        after: null,
      });
      await writeData(data);
      return { ok: true, images: imageRecordsForViewer(university) };
    },

    async migrateLegacyImagesFromDirectory() {
      const files = await pickDirectory();
      if (!files.length) return { ok: false, message: '선택한 폴더 안에서 이미지 파일을 찾지 못했습니다.' };
      const data = await readData();
      const filesByName = buildDirectoryFileIndex(files);
      const stats = { totalRefs: 0, missing: 0, uploaded: 0, reused: 0, updated: 0 };
      const uploadCache = new Map();
      const jobs = collectLegacyImageJobs(data, filesByName, uploadCache, stats);
      if (!jobs.length) {
        return { ok: true, ...stats, message: '이전할 기존 PC 그림 경로가 없습니다.' };
      }
      postMigrationProgress({ status: 'started', totalRefs: stats.totalRefs, fileCount: files.length });
      for (let index = 0; index < jobs.length; index += 1) {
        await jobs[index]();
        postMigrationProgress({ status: 'working', current: index + 1, total: jobs.length, uploaded: stats.uploaded, updated: stats.updated, missing: stats.missing });
      }
      updateChangeLog(data, {
        type: 'legacy-image-migration',
        universityName: '기존 그림 웹 저장소 이전',
        before: null,
        after: stats,
      });
      await writeData(data);
      postMigrationProgress({ status: 'done', ...stats });
      return { ok: true, ...stats };
    },

    async updateSettings(settings) {
      const data = await readData();
      data.settings = { ...(data.settings || {}), ...(settings || {}) };
      await writeData(data);
      return data.settings;
    },

    async updateUniversity(university) {
      const data = await readData();
      const index = data.universities.findIndex((item) => Number(item.id) === Number(university.id));
      if (index < 0) throw new Error('대학 정보를 찾을 수 없습니다.');
      const before = data.universities[index];
      data.universities[index] = { ...before, ...university, updatedAt: new Date().toISOString() };
      updateChangeLog(data, {
        type: 'university-update',
        universityId: university.id,
        universityName: university.name,
        before,
        after: data.universities[index],
      });
      await writeData(data);
      return data.universities[index];
    },

    async deleteUniversity(universityId) {
      const data = await readData();
      const index = data.universities.findIndex((item) => Number(item.id) === Number(universityId));
      if (index < 0) throw new Error('대학 정보를 찾을 수 없습니다.');
      const removed = data.universities.splice(index, 1)[0];
      data.admissionGradeRules = (data.admissionGradeRules || []).filter((rule) => Number(rule.universityId) !== Number(universityId));
      updateChangeLog(data, {
        type: 'university-delete',
        universityId: removed.id,
        universityName: removed.name,
        before: removed,
        after: null,
      });
      await writeData(data);
      return removed;
    },

    async setUniversitiesChecked(universityIds, checked) {
      const ids = new Set((Array.isArray(universityIds) ? universityIds : []).map(Number));
      const data = await readData();
      data.universities = data.universities.map((university) => ids.has(Number(university.id))
        ? {
          ...university,
          checkedComplete: checked,
          isChecked: checked,
          checked,
          latestAdmissionComplete: checked ? true : university.latestAdmissionComplete,
          latestAdmissionSource: checked && !university.latestAdmissionSource ? '수동 최신입시요강 체크' : university.latestAdmissionSource,
        }
        : university);
      await writeData(data);
      return { ok: true, count: ids.size };
    },

    async applyUniversityRuleTemplate(sourceUniversityId, targetUniversityIds = [], options = {}) {
      const data = await readData();
      const source = getUniversity(data, sourceUniversityId);
      const targetIds = new Set((Array.isArray(targetUniversityIds) ? targetUniversityIds : []).map(Number).filter((id) => id && id !== Number(sourceUniversityId)));
      const sourceRule = (data.admissionGradeRules || [])
        .filter((rule) => Number(rule.universityId) === Number(sourceUniversityId) && rule.active !== false)[0];
      let count = 0;
      data.universities = data.universities.map((university) => {
        if (!targetIds.has(Number(university.id))) return university;
        count += 1;
        const next = { ...university };
        if (options.copyRatios !== false) {
          next.gradeRatio = source.gradeRatio;
          next.skillRatio = source.skillRatio;
          next.gradeMaxScore = source.gradeMaxScore;
        }
        if (options.copySubjects !== false) {
          next.subjects = source.subjects;
          next.requiredScores = source.requiredScores ? { ...source.requiredScores } : next.requiredScores;
        }
        if (options.copyCutScores !== false) {
          next.cutGpa = source.cutGpa;
          next.sampleSkill = source.sampleSkill;
          next.acceptedStats = source.acceptedStats ? { ...source.acceptedStats } : next.acceptedStats;
        }
        return next;
      });
      if (sourceRule) {
        data.admissionGradeRules = Array.isArray(data.admissionGradeRules) ? data.admissionGradeRules : [];
        data.universities.forEach((university) => {
          if (!targetIds.has(Number(university.id))) return;
          const index = data.admissionGradeRules.findIndex((rule) => Number(rule.universityId) === Number(university.id) && rule.active !== false);
          const cloned = {
            ...sourceRule,
            id: index >= 0 ? data.admissionGradeRules[index].id : nextId(data.admissionGradeRules),
            universityId: university.id,
            admissionYear: sourceRule.admissionYear || university.year || 2027,
            ruleName: `${university.name || ''} ${university.major || ''} 환산 규칙`.trim(),
            updatedAt: new Date().toISOString(),
          };
          if (index >= 0) data.admissionGradeRules[index] = cloned;
          else data.admissionGradeRules.push({ ...cloned, createdAt: new Date().toISOString() });
        });
      }
      updateChangeLog(data, {
        type: 'bulk-rule-template',
        universityId: source.id,
        universityName: source.name,
        before: null,
        after: { count },
      });
      await writeData(data);
      return { ok: true, count };
    },

    async addUniversity(university) {
      const data = await readData();
      const item = { ...university, id: nextId(data.universities), createdAt: new Date().toISOString() };
      data.universities.push(item);
      await writeData(data);
      return item;
    },

    async saveGradeRule(rule) {
      const data = await readData();
      data.admissionGradeRules = Array.isArray(data.admissionGradeRules) ? data.admissionGradeRules : [];
      let saved;
      if (rule.id) {
        const index = data.admissionGradeRules.findIndex((item) => Number(item.id) === Number(rule.id));
        saved = { ...rule, updatedAt: new Date().toISOString() };
        if (index >= 0) data.admissionGradeRules[index] = { ...data.admissionGradeRules[index], ...saved };
        else data.admissionGradeRules.push({ ...saved, id: nextId(data.admissionGradeRules), createdAt: new Date().toISOString() });
      } else {
        saved = { ...rule, id: nextId(data.admissionGradeRules), createdAt: new Date().toISOString() };
        data.admissionGradeRules.push(saved);
      }
      await writeData(data);
      return saved;
    },

    async saveStrategyImage(dataUrl) {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      downloadFile(`지원전략_${new Date().toISOString().slice(0, 10)}.png`, blob, 'image/png');
      return { ok: true, filePath: '다운로드 폴더' };
    },

    async createBackup() {
      const data = await readData();
      downloadFile(`입시컨설팅_백업_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
      return { ok: true, filePath: '다운로드 폴더' };
    },

    async restoreBackup() {
      const files = await pickFiles('application/json,.json', false);
      if (!files.length) return { ok: false };
      const parsed = await parseJsonFile(files[0]);
      if (!parsed.universities || !parsed.students) throw new Error('올바른 백업 파일이 아닙니다.');
      await writeData(normalizeData(parsed));
      return { ok: true };
    },

    async importStudentsAppend() {
      const files = await pickFiles('application/json,.json', false);
      if (!files.length) return { ok: false };
      const imported = normalizeImportItems(await parseJsonFile(files[0]), 'students');
      const data = await readData();
      let id = nextId(data.students);
      const now = new Date().toISOString();
      const added = imported.map((item) => ({ ...item, id: id++, importedAt: now }));
      data.students.push(...added);
      await writeData(data);
      return { ok: true, count: added.length };
    },

    async importUniversitiesAppend() {
      const files = await pickFiles('application/json,.json', false);
      if (!files.length) return { ok: false };
      const imported = normalizeImportItems(await parseJsonFile(files[0]), 'universities');
      const data = await readData();
      let id = nextId(data.universities);
      const now = new Date().toISOString();
      const added = imported.map((item) => ({ ...item, id: id++, importedAt: now }));
      data.universities.push(...added);
      updateChangeLog(data, {
        universityName: '대학 데이터 추가',
        before: null,
        after: { count: added.length },
      });
      await writeData(data);
      return { ok: true, count: added.length };
    },

    async exportStudents() {
      const data = await readData();
      downloadFile(`학생데이터_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ students: data.students }, null, 2));
      return { ok: true, filePath: '다운로드 폴더', count: data.students.length };
    },

    async exportUniversities() {
      const data = await readData();
      downloadFile(`대학데이터_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ universities: data.universities }, null, 2));
      return { ok: true, filePath: '다운로드 폴더', count: data.universities.length };
    },

    async getDataPath() {
      return '웹판 데이터와 새로 저장한 이미지는 사이트의 웹 저장소에 보관됩니다. 기존 PC 그림은 설정 / 백업에서 그림 폴더를 선택해 한 번 이전하세요.';
    },
  };
}());
