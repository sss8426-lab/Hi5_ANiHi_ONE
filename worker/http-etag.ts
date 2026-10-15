// Large, rarely changing JSON (입시 데이터, 학생 목록): the browser keeps a copy and revalidates each time.
/** JSON with a content ETag: an unchanged answer is a body-less 304, and the browser revalidates every time. */
export async function jsonWithEtag(request: Request, value: unknown) {
  const body = JSON.stringify(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const etag = `"${Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')}"`;
  const headers = { 'cache-control': 'private, no-cache', etag, vary: 'cookie' };
  if ((request.headers.get('if-none-match') || '').split(',').some(tag => tag.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
}

