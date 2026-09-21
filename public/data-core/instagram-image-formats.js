const FORMATS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
const EXTENSIONS = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', avif:'image/avif', bmp:'image/bmp' };

// Only generic legacy metadata may fall back to an extension; never reinterpret SVG/HTML as raster.
export function instagramImageMime(mime, name = '') {
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  const normalized = ({'image/jpg':'image/jpeg', 'image/pjpeg':'image/jpeg', 'image/x-png':'image/png', 'image/x-ms-bmp':'image/bmp'})[type] || type;
  if (FORMATS.has(normalized)) return normalized;
  if (!type || type === 'application/octet-stream') return EXTENSIONS[String(name).split('.').pop().toLowerCase()] || '';
  return '';
}
