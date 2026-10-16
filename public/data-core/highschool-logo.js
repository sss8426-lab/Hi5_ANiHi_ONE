// 고교 진학 상담 '로고 선택': 인스타그램 제작과 같은 로고(기본 6가지 + 캠퍼스가 올린 로고)를 그려
// 상담 자료에 넣을 그림 두 장으로 만든다. src = 흰 종이용(여백만 잘라 냄), band = 1~4쪽 어두운 띠용 흰 로고.
import { drawLogo } from './instagram-layout.js?v=20260924-layers';

const INK = 0.08; // 이보다 옅은 점(흰 바탕·투명)은 여백으로 본다

function inkOf(d, i) { return (d[i + 3] / 255) * ((255 - Math.min(d[i], d[i + 1], d[i + 2])) / 255); }

// 그린 로고에서 글자·그림이 있는 곳만 남기고(비율 그대로) 두 가지 그림 주소로
export function logoImages(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (inkOf(d, (y * w + x) * 4) > INK) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = Math.round((y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const o = out.getContext('2d');
  o.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  const src = out.toDataURL('image/png');
  const img = o.getImageData(0, 0, cw, ch);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const a = Math.min(255, Math.round(inkOf(p, i) * 255 * 1.4));
    p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = a;
  }
  o.putImageData(img, 0, 0);
  // 두 줄짜리처럼 가로가 짧은 로고(가로÷세로 4 미만)는 조금 크게 넣는다
  return { src, band: out.toDataURL('image/png'), tall: cw / ch < 4 };
}

// type: '' = 예전 ANiHi 만화학원 로고(바꾸지 않음), 'none' = 로고 없이, 그 밖에는 인스타그램 로고 종류(custom:<id> 포함)
const cache = new Map();
export async function reportLogo(type, label) {
  if (!type) return null;
  if (type === 'none') return { none: true };
  const key = `${type}|${label}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const canvas = document.createElement('canvas');
      await drawLogo(canvas, type, label || '');
      return logoImages(canvas);
    })().catch((error) => { cache.delete(key); throw error; }));
  }
  return cache.get(key);
}
