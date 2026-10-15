export const PRIVATE_IMAGE_MIMES = new Set(['image/jpeg','image/png','image/webp','image/avif','image/gif']);

// Call only AFTER current file/source authorization and R2 existence checks.
export async function privateImageResponse(request: Request | undefined, object: R2ObjectBody | R2Object, headers: Headers, mime: string, preview = true) {
  const revalidate = preview && PRIVATE_IMAGE_MIMES.has(mime);
  const etag = (object as { httpEtag?: string }).httpEtag || JSON.stringify((object as { etag?: string }).etag);
  headers.set('cache-control', revalidate ? 'private, no-cache' : 'private, no-store');
  headers.set('etag', etag);
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('x-content-type-options', 'nosniff');
  if (revalidate && ['GET','HEAD'].includes(request?.method || 'GET')) {
    const tags = request?.headers.get('if-none-match')?.split(',').map(t=>t.trim().replace(/^W\//,'')) || [];
    if (tags.includes('*') || tags.includes(etag.replace(/^W\//,''))) {
      if ('body' in object) await object.body.cancel();
      return new Response(null,{status:304,headers});
    }
  }
  if (request?.method === 'HEAD') { if ('body' in object) await object.body.cancel(); return new Response(null,{headers}); }
  return new Response('body' in object ? object.body : null,{headers});
}

// R2 read that skips the file body when the browser's copy is still current (previewable images only).
// The caller has already checked permission; privateImageResponse then answers 304 from the metadata.
export async function conditionalImageGet(bucket: R2Bucket, key: string, request: Request | undefined, mime: string, preview = true): Promise<R2ObjectBody | R2Object | null> {
  const method = request?.method || 'GET';
  const tag = preview && PRIVATE_IMAGE_MIMES.has(mime) && method === 'GET'
    ? (request?.headers.get('if-none-match') || '').split(',')[0].trim().replace(/^W\//, '').replace(/^"|"$/g, '') : '';
  if (!tag || tag === '*') return bucket.get(key);
  const object = await bucket.get(key, { onlyIf: { etagDoesNotMatch: tag } });
  // A body-less answer means "not modified"; anything unexpected falls back to a normal read.
  if (object && !('body' in object) && object.etag !== tag) return bucket.get(key);
  return object;
}
