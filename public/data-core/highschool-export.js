// 고교 진학 상담 자료 저장: 화면에 그린 A4 쪽을 그대로 그림(1588×2246, 예전 자료와 같은 크기)으로 만들어
// PDF 한 파일, 또는 쪽별 PNG 묶음(zip)으로 바로 내려받는다. 서버에 보내지 않고 이 컴퓨터에서만 만든다.
import { zipSync } from './vendor/fflate-0.8.3.js';
import { LOGO } from './highschool-report.js?v=20261017-hs9';

const W = 794, H = 1123, SCALE = 2; // A4 210×297mm를 96dpi로, 2배로 그린다

const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
async function dataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
}
let assets = null;
async function loadAssets() {
  if (!assets) {
    const cssUrl = [...document.querySelectorAll('link[rel=stylesheet]')].find((l) => l.href.includes('highschool-report.css'))?.href;
    assets = Promise.all([fetch(cssUrl).then((r) => r.text()), dataUrl(LOGO)]).then(([css, logo]) => ({ css, logo }));
  }
  return assets;
}

// 한 쪽(section)을 캔버스로: 그림 안에 HTML을 넣어(SVG foreignObject) 그대로 그린다
export async function pageCanvas(section) {
  const { css, logo } = await loadAssets();
  const clone = section.cloneNode(true);
  for (const img of clone.querySelectorAll('img')) if (img.getAttribute('src') === LOGO) img.setAttribute('src', logo);
  const body = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" class="hs-report" style="margin:0;padding:0;background:#fff;width:${W}px;height:${H}px"><style>${xml(css)} .hs-report .page,.hs-report .ip{margin:0!important;box-shadow:none!important}</style>${body}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
const canvasBytes = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('그림을 만들지 못했습니다.'))), type, quality));

// JPEG 쪽들을 A4 PDF 한 파일로(쪽마다 그림 한 장)
export function makePdf(images) {
  const enc = new TextEncoder(), parts = [], offsets = [];
  let length = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); length += b.length; };
  const obj = (n, ...body) => { offsets[n] = length; push(`${n} 0 obj\n`); body.forEach(push); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${images.length} >>`);
  images.forEach((im, i) => {
    const p = 3 + 3 * i, draw = `q 595.28 0 0 841.89 0 0 cm /Im${i} Do Q`;
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, '\nendstream');
  });
  const xref = length, size = 3 + 3 * images.length;
  push(`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const b of parts) { out.set(b, at); at += b.length; }
  return out;
}

export const fileName = (name) => String(name || '학생').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
function download(bytes, type, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// pages: [{ name, section }] — 화면에 그려진 순서대로
export async function savePdf(studentName, pages, progress = () => {}) {
  const images = [];
  for (const [i, p] of pages.entries()) {
    progress(i + 1, pages.length);
    const canvas = await pageCanvas(p.section);
    images.push({ bytes: await canvasBytes(canvas, 'image/jpeg', 0.92), width: canvas.width, height: canvas.height });
  }
  download(makePdf(images), 'application/pdf', `고교진학상담_${fileName(studentName)}.pdf`);
}
export async function saveImages(studentName, pages, progress = () => {}) {
  const files = {};
  for (const [i, p] of pages.entries()) {
    progress(i + 1, pages.length);
    files[`${String(i + 1).padStart(2, '0')}_${p.name}.png`] = [await canvasBytes(await pageCanvas(p.section), 'image/png'), { level: 0 }];
  }
  download(zipSync(files), 'application/zip', `고교진학상담_${fileName(studentName)}_이미지.zip`);
}
