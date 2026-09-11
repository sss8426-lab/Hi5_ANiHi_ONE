export const PRIVATE_IMAGE_MIMES = new Set(['image/jpeg','image/png','image/webp','image/avif','image/gif']);

// Call only AFTER current file/source authorization and R2 existence checks.
export async function privateImageResponse(request: Request | undefined, object: R2ObjectBody, headers: Headers, mime: string, preview = true) {
  const revalidate = preview && PRIVATE_IMAGE_MIMES.has(mime);
  headers.set('cache-control', revalidate ? 'private, no-cache' : 'private, no-store');
  headers.set('etag', object.httpEtag);
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('x-content-type-options', 'nosniff');
  if (revalidate && ['GET','HEAD'].includes(request?.method || 'GET')) {
    const tags = request?.headers.get('if-none-match')?.split(',').map(t=>t.trim().replace(/^W\//,'')) || [];
    if (tags.includes('*') || tags.includes(object.httpEtag.replace(/^W\//,''))) {
      await object.body.cancel();
      return new Response(null,{status:304,headers});
    }
  }
  if (request?.method === 'HEAD') { await object.body.cancel(); return new Response(null,{headers}); }
  return new Response(object.body,{headers});
}
