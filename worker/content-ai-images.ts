import { imageSize } from 'image-size';
import { decode, encode } from 'fast-png';
import { inflateSync } from 'node:zlib';
import pica from 'pica';
import { DataCoreAccessError } from './data-core-access';

export const AI_IMAGE_BYTES = 8 * 1024 * 1024;
export const AI_TOTAL_BYTES = 16 * 1024 * 1024;
export const AI_PHOTO_LIMIT = 6;
const unsupported = () => new DataCoreAccessError(415, '이 이미지는 AI 편집에 사용할 수 없습니다.');
const join = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString('ascii');

// Retain only orientation, never the original EXIF block (GPS, names, camera details).
function orientationOnly(bytes: Uint8Array) {
  const start = ascii(bytes.subarray(0, 6)) === 'Exif\0\0' ? 6 : 0;
  const tiff = bytes.subarray(start);
  if (tiff.length < 8) throw unsupported();
  const little = ascii(tiff.subarray(0, 2)) === 'II';
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if ((!little && ascii(tiff.subarray(0, 2)) !== 'MM') || view.getUint16(2, little) !== 42) throw unsupported();
  const offset = view.getUint32(4, little);
  if (offset + 2 > tiff.length) throw unsupported();
  const count = view.getUint16(offset, little);
  if (count > 1024 || offset + 2 + count * 12 > tiff.length) throw unsupported();
  let orientation = 1;
  for (let n = 0; n < count; n++) {
    const p = offset + 2 + n * 12;
    if (view.getUint16(p, little) !== 0x112) continue;
    if (view.getUint16(p + 2, little) !== 3 || view.getUint32(p + 4, little) !== 1) throw unsupported();
    orientation = view.getUint16(p + 8, little);
    if (orientation < 1 || orientation > 8) throw unsupported();
  }
  const clean = Uint8Array.from([0x49,0x49,42,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
  return { orientation, tiff: clean };
}

export function sanitizeAiImage(input: Uint8Array, mime: string): Uint8Array {
  try {
    if (!input.length || input.length > AI_IMAGE_BYTES) throw unsupported();
    const size = imageSize(input);
    if (!size.width || !size.height || size.width * size.height > 40000000) throw unsupported();
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    if (mime === 'image/jpeg' && size.type === 'jpg') {
      const parts: Uint8Array[] = [input.subarray(0, 2)];
      let p = 2, count = 0, scan = false, ended = false;
      while (p < input.length && ++count < 4096) {
        if (input[p] !== 255) throw unsupported();
        const marker = input[p + 1];
        if (marker === 0xd9) { parts.push(input.subarray(p,p + 2)); ended = true; break; }
        const length = view.getUint16(p + 2);
        if (length < 2 || p + length + 2 > input.length) throw unsupported();
        const chunk = input.subarray(p, p + length + 2);
        if (marker === 0xda) {
          const start = p;
          p += length + 2;
          while (p < input.length) {
            if (input[p] !== 255) { p++; continue; }
            if (input[p + 1] === 0 || input[p + 1] >= 0xd0 && input[p + 1] <= 0xd7) { p += 2; continue; }
            if (input[p + 1] === 255) { p++; continue; }
            break;
          }
          parts.push(input.subarray(start,p)); scan = true; continue;
        }
        if (marker === 0xe1 && ascii(chunk.subarray(4, 10)) === 'Exif\0\0') {
          const clean = orientationOnly(chunk.subarray(4)).tiff;
          parts.push(join([Uint8Array.from([255,225,0,34]), Buffer.from('Exif\0\0'), clean]));
        } else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(chunk);
        p += length + 2;
      }
      if (!scan || !ended) throw unsupported();
      return join(parts);
    }
    if (mime === 'image/png' && size.type === 'png') {
      const parts = [input.subarray(0, 8)];
      let p = 8, count = 0, ended = false;
      while (p + 12 <= input.length && ++count < 4096) {
        const length = view.getUint32(p), end = p + length + 12;
        if (end > input.length) throw unsupported();
        const type = ascii(input.subarray(p + 4, p + 8));
        if (['acTL','fcTL','fdAT'].includes(type)) throw unsupported();
        if (type === 'eXIf' && orientationOnly(input.subarray(p + 8, end - 4)).orientation !== 1) throw unsupported();
        if (['IHDR','PLTE','tRNS','IDAT','IEND','sRGB','gAMA','cHRM'].includes(type)) parts.push(input.subarray(p, end));
        if (type === 'IEND') { ended = true; break; }
        p = end;
      }
      if (!ended) throw unsupported();
      return join(parts);
    }
    if (mime === 'image/webp' && size.type === 'webp') {
      const parts: Uint8Array[] = [];
      let p = 12, count = 0, image = false, exif = false;
      while (p + 8 <= input.length && ++count < 4096) {
        const length = view.getUint32(p + 4, true), end = p + 8 + length + (length % 2);
        if (end > input.length) throw unsupported();
        const type = ascii(input.subarray(p, p + 4));
        if (['ANIM','ANMF'].includes(type)) throw unsupported();
        if (type === 'EXIF') {
          const clean = orientationOnly(input.subarray(p + 8, p + 8 + length)).tiff;
          parts.push(join([Buffer.from('EXIF'), Uint8Array.from([26,0,0,0]), clean])); exif = true;
        } else if (['VP8X','VP8 ','VP8L','ALPH'].includes(type)) {
          const chunk = input.slice(p, end);
          if (type === 'VP8X') { if (chunk[8] & 2) throw unsupported(); chunk[8] &= ~0x2c; }
          if (['VP8 ','VP8L'].includes(type)) image = true;
          parts.push(chunk);
        }
        p = end;
      }
      if (!image || p !== input.length) throw unsupported();
      if (exif) { const extended = parts.find(part => ascii(part.subarray(0,4)) === 'VP8X'); if (!extended) throw unsupported(); extended[8] |= 8; }
      const body = join(parts), header = input.slice(0, 12);
      new DataView(header.buffer).setUint32(4, body.length + 4, true);
      return join([header, body]);
    }
    throw unsupported();
  } catch { throw unsupported(); }
}

export async function normalizeAiPng(input: Uint8Array) {
  const bytes = sanitizeAiImage(input, 'image/png');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (width * height > 4194304 || bytes[24] !== 8 || ![2,6].includes(bytes[25]) || bytes[28]) throw unsupported();
  const compressed: Uint8Array[] = [];
  for (let p = 8; p < bytes.length; p += view.getUint32(p) + 12) {
    if (ascii(bytes.subarray(p + 4, p + 8)) === 'IDAT') compressed.push(bytes.subarray(p + 8, p + 8 + view.getUint32(p)));
  }
  const channels = bytes[25] === 6 ? 4 : 3, expected = (width * channels + 1) * height;
  if (inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }).length !== expected) throw unsupported();
  const decoded = decode(bytes, { checkCrc: true });
  const cropWidth = Math.min(width, Math.round(height * 4 / 5));
  const cropHeight = Math.min(height, Math.round(width * 5 / 4));
  const left = Math.floor((width - cropWidth) / 2), top = Math.floor((height - cropHeight) / 2);
  const rgba = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) for (let x = 0; x < cropWidth; x++) {
    const from = ((y + top) * width + x + left) * channels, to = (y * cropWidth + x) * 4;
    rgba[to] = decoded.data[from]; rgba[to + 1] = decoded.data[from + 1]; rgba[to + 2] = decoded.data[from + 2];
    rgba[to + 3] = channels === 4 ? decoded.data[from + 3] : 255;
  }
  const data = await pica({ features: ['js'] }).resizeBuffer({ src: rgba, width: cropWidth, height: cropHeight, toWidth: 2160, toHeight: 2700, filter: 'lanczos3' });
  const output = encode({ width: 2160, height: 2700, data, channels: 4, depth: 8 });
  if (output.length > AI_IMAGE_BYTES) throw unsupported();
  return output;
}
