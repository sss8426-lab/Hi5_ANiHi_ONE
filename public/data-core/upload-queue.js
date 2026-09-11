/* Actual XHR multipart-byte progress, with bounded memory and concurrency. */
class DataCoreUploadQueue {
  constructor(files, target, onChange, transport = DataCoreUploadQueue.send) {
    this.items = files.map(file => ({ file, status: 'waiting', loaded: 0, total: file.size, result: null }));
    this.target = Object.freeze({ ...target });
    this.onChange = onChange;
    this.transport = transport;
    this.running = false;
    this.cancelled = false;
    this.controllers = new Set();
  }
  snapshot() {
    const success = this.items.filter(i => i.status === 'done').length;
    const failed = this.items.filter(i => i.status === 'failed').length;
    const total = this.items.reduce((n, i) => n + i.total, 0);
    const loaded = this.items.reduce((n, i) => n + Math.min(i.loaded, i.total), 0);
    return { total, loaded, success, failed, count: this.items.length, running: this.running, cancelled: this.cancelled,
      percent: success === this.items.length ? 100 : Math.min(99, Math.floor(total ? loaded / total * 100 : 0)),
      current: this.items.filter(i => i.status === 'uploading').map(i => i.file.name).join(', ') };
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
    if (retry) for (const i of this.items) if (i.status === 'failed') { i.status = 'waiting'; i.loaded = 0; }
    this.notify();
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
          });
          item.status = 'done'; item.loaded = item.total;
        } catch (error) {
          item.status = controller.signal.aborted ? 'cancelled' : 'failed';
          item.error = error.message;
        } finally { this.controllers.delete(controller); this.notify(); }
      }
    };
    await Promise.all(Array.from({length: Math.min(3, this.items.length)}, worker));
    if (this.cancelled) for (const item of this.items) if (item.status === 'waiting') item.status = 'cancelled';
    this.running = false;
    this.notify();
  }
  static send(file, target, signal, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      for (const [key,value] of Object.entries(target)) if (key !== 'libraryScoped') form.append(key, value);
      xhr.open('POST', target.libraryScoped === true ? '/api/data-core/library/files' : '/api/data-core/files');
      xhr.timeout = 180000;
      xhr.responseType = 'json';
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded, event.total); };
      const abort = () => xhr.abort();
      const finish = (error, value) => { signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? finish(null, xhr.response) : finish(new Error(xhr.response?.error || `업로드 실패 (${xhr.status})`));
      xhr.onerror = () => finish(new Error('연결 오류입니다. 갤러리를 확인한 뒤 다시 시도하세요.'));
      xhr.ontimeout = () => finish(new Error('응답 시간이 초과되었습니다. 갤러리를 확인해 주세요.'));
      xhr.onabort = () => finish(new Error('업로드 취소'));
      signal.addEventListener('abort', abort, { once:true });
      if (signal.aborted) return finish(new Error('업로드 취소'));
      xhr.send(form);
    });
  }
}
globalThis.DataCoreUploadQueue = DataCoreUploadQueue;
