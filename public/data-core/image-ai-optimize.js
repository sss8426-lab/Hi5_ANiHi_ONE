// Shared by blog (content.js) and Instagram (instagram-carousel.js): resizes/compresses one
// selected photo for an AI request in the browser. The R2 original itself is never touched. Tries
// the ladder in order and keeps the smallest attempt as a fallback so a stubborn photo still lands
// under the hard cap instead of failing outright.
export const AI_OPTIMIZE_STEPS = [
  { edge: 2048, quality: 0.82 },
  { edge: 1800, quality: 0.78 },
  { edge: 1600, quality: 0.74 },
  { edge: 1280, quality: 0.70 },
];
export const AI_OPTIMIZE_TARGET_BYTES = 1.5 * 1024 * 1024;
export const AI_OPTIMIZE_HARD_CAP_BYTES = 2 * 1024 * 1024;

export async function optimizeImageForAi(file) {
  const name = file.fileName || '사진';
  const url = file.previewUrl || '/api/data-core/files/' + encodeURIComponent(file.id);
  let sourceBlob;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error();
    sourceBlob = await response.blob();
  } catch { throw new Error(`${name} 사진을 불러오지 못했습니다.`); }
  let bitmap;
  try { bitmap = await createImageBitmap(sourceBlob); }
  catch { throw new Error(`${name} 사진을 AI 분석용으로 준비하지 못했습니다.`); }
  try {
    let best = null;
    for (const step of AI_OPTIMIZE_STEPS) {
      const scale = Math.min(1, step.edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, width, height);
      best = await canvas.convertToBlob({ type: 'image/jpeg', quality: step.quality });
      if (best.size <= AI_OPTIMIZE_TARGET_BYTES) break;
    }
    if (!best || !best.size || best.size > AI_OPTIMIZE_HARD_CAP_BYTES) throw new Error(`${name} 사진을 AI 분석용으로 준비하지 못했습니다.`);
    return best;
  } finally {
    bitmap.close();
  }
}
