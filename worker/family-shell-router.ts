import appWorker from "./readiness-router";
import { handleKkumeumConsentApi } from "./kkumeum-consent-router";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  FAMILY_DB?: D1Database;
  FAMILY_FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
}

async function familyShell(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/family" && url.pathname !== "/family/") return null;
  if (!env.ASSETS) return new Response("Not found", { status: 404 });
  url.pathname = "/family/index.html";
  const response = await env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.delete("content-length");
  return new Response(response.body, { status: response.status, headers });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const shell = await familyShell(request, env);
    if (shell) return shell;
    const consent = await handleKkumeumConsentApi(request, env);
    if (consent) return consent;
    return appWorker.fetch(request, env);
  },
};

export default worker;
