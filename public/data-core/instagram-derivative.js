(function () {
  'use strict';
  const WIDTH = 2160, HEIGHT = 2700, MAX_BYTES = 8 * 1024 * 1024;
  const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  function eligible(file) {
    return Boolean(file && imageTypes.has(file.mimeType) && file.category !== 'instagram-derived');
  }
  function crop(width, height, x = 50, y = 50) {
    if (!(width > 0 && height > 0)) throw new Error('Invalid image dimensions');
    const scale = Math.max(WIDTH / width, HEIGHT / height);
    const sw = WIDTH / scale, sh = HEIGHT / scale;
    const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0)) / 100;
    return { sx: (width - sw) * clamp(x), sy: (height - sh) * clamp(y), sw, sh };
  }
  function mount({ canWrite, onSaved, onError }) {
    const el = (id) => document.getElementById(id);
    const root = el('instagramDerivative'), select = el('derivativeSource');
    const make = el('makeInstagramImage'), save = el('saveDerivative');
    const canvas = el('instagramCanvas'), preview = el('derivativePreview');
    const x = el('derivativeX'), y = el('derivativeY'), status = el('derivativeStatus');
    let candidates = [], bitmap = null, loadedId = '', generation = 0, busy = false, objectUrl = '';
    function controls() {
      select.disabled = busy;
      make.disabled = busy || !select.value || !canWrite();
      save.disabled = busy || !bitmap || !canWrite();
      x.disabled = busy || !bitmap || bitmap.width / bitmap.height <= WIDTH / HEIGHT;
      y.disabled = busy || !bitmap || bitmap.width / bitmap.height >= WIDTH / HEIGHT;
    }
    function reset() {
      generation += 1;
      bitmap?.close(); bitmap = null; loadedId = ''; busy = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = ''; el('derivativeOriginal').removeAttribute('src');
      canvas.getContext('2d').clearRect(0, 0, WIDTH, HEIGHT);
      preview.hidden = true; status.textContent = ''; x.value = y.value = '50'; controls();
    }
    function draw() {
      if (!bitmap) return;
      const rect = crop(bitmap.width, bitmap.height, x.value, y.value);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, WIDTH, HEIGHT);
    }
    select.onchange = reset;
    x.oninput = y.oninput = draw;
    make.onclick = async () => {
      reset();
      const source = candidates.find((file) => String(file.id) === select.value);
      if (!eligible(source) || !canWrite()) return;
      const token = generation;
      busy = true; status.textContent = '이미지 준비 중...'; controls();
      try {
        const response = await fetch(`/api/data-core/files/${encodeURIComponent(source.id)}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('원본 이미지를 읽을 수 없습니다.');
        const blob = await response.blob();
        if (blob.size > 20 * 1024 * 1024 || !imageTypes.has(blob.type)) throw new Error('20MB 이하의 JPEG, PNG, WebP 이미지를 선택하세요.');
        const decoded = await createImageBitmap(blob);
        if (token !== generation) { decoded.close(); return; }
        if (decoded.width * decoded.height > 40000000) { decoded.close(); throw new Error('이미지가 너무 큽니다.'); }
        bitmap = decoded; loadedId = String(source.id);
        objectUrl = URL.createObjectURL(blob); el('derivativeOriginal').src = objectUrl;
        preview.hidden = false; draw(); status.textContent = '';
      } catch (error) {
        if (token === generation) { status.textContent = error.message; onError(error.message); }
      } finally { if (token === generation) { busy = false; controls(); } }
    };
    save.onclick = async () => {
      if (!bitmap || busy || !canWrite()) return;
      const token = generation, sourceId = loadedId;
      busy = true; status.textContent = '파생 이미지 저장 중...'; controls();
      try {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (token !== generation) return;
        if (!blob || blob.size > MAX_BYTES) throw new Error('파생 이미지가 8MB를 초과합니다. 더 작은 원본을 선택하세요.');
        const form = new FormData();
        form.append('file', blob, 'instagram-4x5.png'); form.append('derivedFromFileId', sourceId);
        const response = await fetch('/api/data-core/instagram/derivatives', {
          method: 'POST', credentials: 'same-origin', body: form,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '파생 이미지를 저장하지 못했습니다.');
        // A save may finish after switching drafts: never attach it to the new draft.
        if (token !== generation) return;
        onSaved(result.file);
        status.textContent = '인스타용 이미지가 저장되었습니다.';
      } catch (error) {
        if (token === generation) { status.textContent = error.message; onError(error.message); }
      } finally { if (token === generation) { busy = false; controls(); } }
    };
    return {
      reset,
      update(files, enabled) {
        root.hidden = !enabled;
        candidates = files.filter(eligible);
        const previous = select.value;
        select.replaceChildren(new Option('원본 이미지 선택', ''), ...candidates.map((file) => new Option(file.fileName || file.id, String(file.id))));
        select.value = candidates.some((file) => String(file.id) === previous) ? previous : (candidates[0]?.id || '');
        if (!enabled || (loadedId && loadedId !== select.value)) reset();
        controls();
      },
    };
  }
  window.HI5InstagramDerivative = { crop, eligible, mount };
})();
