/* Small files keep the proven form upload; large library files stream to R2 multipart in fixed chunks. */
class DataCoreUploadQueue {
  static SIMPLE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
  static LIBRARY_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
  static MULTIPART_CHUNK_BYTES = 16 * 1024 * 1024;
  static MULTIPART_CONCURRENCY = 3;
  static BLOCKED_EXTENSIONS = new Set(['exe','dll','bat','cmd','com','msi','scr','ps1','vbs','js','mjs','jar']);

  constructor(files, target, onChange, transport = DataCoreUploadQueue.send) {
    this.target = Object.freeze({ ...target });
    this.items = files.map(file => {
      const preflightError = this.target.libraryScoped === true ? DataCoreUploadQueue.preflight(file) : '';
      return { file, status: preflightError ? 'failed' : 'waiting', loaded: 0, total: file.size, result: null,
        error: preflightError || '', retryable: !preflightError, multipart: null };
    });
    this.onChange = onChange;
    this.transport = transport;
    this.running = false;
    this.cancelled = false;
    this.controllers = new Set();
  }
  static extension(name) {
    const normalized = String(name || '').trim().toLowerCase();
    const index = normalized.lastIndexOf('.');
    return index >= 0 ? normalized.slice(index + 1) : '';
  }
  static preflight(file) {
    if (!file?.name || /[\u0000-\u001f]/.test(file.name) || [...file.name].length > 240) return '파일 이름을 확인해 주세요.';
    if (!Number.isFinite(file.size) || file.size <= 0) return '빈 파일은 업로드할 수 없습니다.';
    if (file.size > DataCoreUploadQueue.LIBRARY_MAX_FILE_SIZE_BYTES) return '이 파일은 2GB를 초과해 업로드할 수 없습니다.';
    if (DataCoreUploadQueue.BLOCKED_EXTENSIONS.has(DataCoreUploadQueue.extension(file.name))) return '실행 파일 또는 스크립트 파일은 업로드할 수 없습니다.';
    return '';
  }
  snapshot() {
    const success = this.items.filter(i => i.status === 'done').length;
    const failed = this.items.filter(i => i.status === 'failed').length;
    const total = this.items.reduce((n, i) => n + i.total, 0);
    const loaded = this.items.reduce((n, i) => n + Math.min(i.loaded, i.total), 0);
    const active = this.items.filter(i => i.status === 'uploading');
    return { total, loaded, success, failed, count: this.items.length, running: this.running, cancelled: this.cancelled,
      percent: success === this.items.length ? 100 : Math.min(99, Math.floor(total ? loaded / total * 100 : 0)),
      current: active.map(i => i.file.name).join(', '),
      currentItems: active.map(i => ({ name: i.file.name, loaded: Math.min(i.loaded, i.total), total: i.total })) };
  }
  notify() { this.onChange(this.snapshot()); }
  cancel() {
    this.cancelled = true;
    for (const controller of this.controllers) controller.abort();
    this.notify();
  }
  async run(retry = false) {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    if (retry) for (const i of this.items) if (i.status === 'failed' && i.retryable !== false) {
      i.status = 'waiting'; i.loaded = 0; i.error = '';
    }
    this.notify();
    const hasLargeLibraryFile = this.target.libraryScoped === true &&
      this.items.some(i => i.status === 'waiting' && i.file.size > DataCoreUploadQueue.SIMPLE_UPLOAD_MAX_BYTES);
    const worker = async () => {
      while (!this.cancelled) {
        const item = this.items.find(i => i.status === 'waiting');
        if (!item) return;
        item.status = 'uploading';
        const controller = new AbortController();
        this.controllers.add(controller);
        this.notify();
        try {
          item.result = await this.transport(item.file, this.target, controller.signal, (loaded, total) => {
            item.loaded = loaded; item.total = total; this.notify();
          }, item);
          item.status = 'done'; item.loaded = item.total; item.error = '';
        } catch (error) {
          item.status = controller.signal.aborted ? 'cancelled' : 'failed';
          item.error = error?.message || '업로드에 실패했습니다.';
          item.retryable = !controller.signal.aborted;
        } finally { this.controllers.delete(controller); this.notify(); }
      }
    };
    const concurrency = hasLargeLibraryFile ? 1 : Math.min(3, this.items.filter(i => i.status === 'waiting').length || 1);
    await Promise.all(Array.from({length: concurrency}, worker));
    if (this.cancelled) for (const item of this.items) if (item.status === 'waiting') item.status = 'cancelled';
    this.running = false;
    this.notify();
  }
  static send(file, target, signal, onProgress, item) {
    if (target.libraryScoped === true && file.size > DataCoreUploadQueue.SIMPLE_UPLOAD_MAX_BYTES) {
      return DataCoreUploadQueue.sendMultipart(file, target, signal, onProgress, item);
    }
    return DataCoreUploadQueue.sendSimple(file, target, signal, onProgress);
  }
  static sendSimple(file, target, signal, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      for (const [key,value] of Object.entries(target)) if (key !== 'libraryScoped') form.append(key, value);
      xhr.open('POST', target.libraryScoped === true ? '/api/data-core/library/files' : '/api/data-core/files');
      xhr.timeout = 180000;
      xhr.responseType = 'json';
      if (target.libraryScoped === true) xhr.setRequestHeader('x-data-core-file-size', String(file.size));
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(event.loaded, file.size), file.size); };
      const abort = () => xhr.abort();
      const finish = (error, value) => { signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? finish(null, xhr.response) : finish(new Error(xhr.response?.error || `업로드 실패 (${xhr.status})`));
      xhr.onerror = () => finish(new Error('네트워크 연결이 중단되었습니다. 다시 시도해 주세요.'));
      xhr.ontimeout = () => finish(new Error('응답 시간이 초과되었습니다. 다시 시도해 주세요.'));
      xhr.onabort = () => finish(DataCoreUploadQueue.abortError());
      signal.addEventListener('abort', abort, { once:true });
      if (signal.aborted) return finish(DataCoreUploadQueue.abortError());
      xhr.send(form);
    });
  }
  static abortError() {
    const error = new Error('업로드 취소');
    error.name = 'AbortError';
    return error;
  }
  static async json(url, options = {}) {
    let response;
    try { response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options }); }
    catch { throw new Error('네트워크 연결이 중단되었습니다. 다시 시도해 주세요.'); }
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const message = body.error || (response.status === 403 ? '이 폴더에 업로드할 권한이 없습니다.'
        : response.status === 410 ? '업로드 세션이 만료되었습니다. 파일을 다시 선택해 주세요.'
        : `업로드 요청에 실패했습니다. (${response.status})`);
      const error = new Error(message); error.status = response.status; throw error;
    }
    return body;
  }
  static partSize(fileSize, chunkSize, partCount, partNumber) {
    return partNumber === partCount ? fileSize - chunkSize * (partCount - 1) : chunkSize;
  }
  static uploadPart(sessionId, partNumber, blob, signal, onPartProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/data-core/library/uploads/${encodeURIComponent(sessionId)}/parts/${partNumber}`);
      xhr.timeout = 180000;
      xhr.responseType = 'json';
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.upload.onprogress = event => { if (event.lengthComputable) onPartProgress(Math.min(event.loaded, blob.size)); };
      const abort = () => xhr.abort();
      const finish = (error, value) => { signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? finish(null, xhr.response)
        : finish(new Error(xhr.response?.error || `업로드 조각 ${partNumber} 저장에 실패했습니다.`));
      xhr.onerror = () => finish(new Error(`네트워크 중단으로 업로드 조각 ${partNumber} 저장에 실패했습니다.`));
      xhr.ontimeout = () => finish(new Error(`업로드 조각 ${partNumber} 응답 시간이 초과되었습니다.`));
      xhr.onabort = () => finish(DataCoreUploadQueue.abortError());
      signal.addEventListener('abort', abort, { once:true });
      if (signal.aborted) return finish(DataCoreUploadQueue.abortError());
      xhr.send(blob);
    });
  }
  static async abortMultipart(state) {
    if (!state?.sessionId || state.aborted || state.completed) return;
    state.aborted = true;
    try {
      await DataCoreUploadQueue.json(`/api/data-core/library/uploads/${encodeURIComponent(state.sessionId)}`, { method:'DELETE' });
    } catch {}
  }
  static async sendMultipart(file, target, signal, onProgress, item = {}) {
    let state = item.multipart;
    let completing = false;
    try {
      if (!state || state.aborted) {
        state = await DataCoreUploadQueue.json('/api/data-core/library/uploads', {
          method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify({ folderId:target.recordId, fileName:file.name, mimeType:file.type || 'application/octet-stream', sizeBytes:file.size }),
        });
        state.parts = new Map();
        state.aborted = false;
        state.completed = false;
        item.multipart = state;
      }
      if (signal.aborted) throw DataCoreUploadQueue.abortError();
      const chunkSize = Number(state.chunkSize) || DataCoreUploadQueue.MULTIPART_CHUNK_BYTES;
      const partCount = Number(state.partCount) || Math.ceil(file.size / chunkSize);
      const inflight = new Map();
      const completedBytes = () => [...state.parts.keys()].reduce((sum, partNumber) =>
        sum + DataCoreUploadQueue.partSize(file.size, chunkSize, partCount, partNumber), 0);
      const report = () => onProgress(Math.min(file.size, completedBytes() + [...inflight.values()].reduce((a,b)=>a+b,0)), file.size);
      report();
      const missing = [];
      for (let partNumber = 1; partNumber <= partCount; partNumber++) if (!state.parts.has(partNumber)) missing.push(partNumber);
      let failure = null;
      const partWorker = async () => {
        while (!signal.aborted && !failure) {
          const partNumber = missing.shift();
          if (!partNumber) return;
          const start = (partNumber - 1) * chunkSize;
          const end = Math.min(file.size, start + chunkSize);
          const blob = file.slice(start, end);
          try {
            const result = await DataCoreUploadQueue.uploadPart(state.sessionId, partNumber, blob, signal, loaded => {
              inflight.set(partNumber, loaded); report();
            });
            inflight.delete(partNumber);
            state.parts.set(partNumber, { partNumber: Number(result.partNumber), etag: result.etag });
            report();
          } catch (error) {
            inflight.delete(partNumber); failure = error; report(); return;
          }
        }
      };
      await Promise.all(Array.from({length:Math.min(DataCoreUploadQueue.MULTIPART_CONCURRENCY, missing.length || 1)}, partWorker));
      if (signal.aborted) throw DataCoreUploadQueue.abortError();
      if (failure) throw failure;
      const parts = [...state.parts.values()].sort((a,b)=>a.partNumber-b.partNumber);
      completing = true;
      const result = await DataCoreUploadQueue.json(`/api/data-core/library/uploads/${encodeURIComponent(state.sessionId)}/complete`, {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ parts }),
      });
      state.completed = true;
      onProgress(file.size, file.size);
      return result;
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') {
        await DataCoreUploadQueue.abortMultipart(state);
        throw DataCoreUploadQueue.abortError();
      }
      if (completing) item.multipart = null;
      throw error;
    }
  }
}
globalThis.DataCoreUploadQueue = DataCoreUploadQueue;
