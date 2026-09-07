import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the admissions web shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko"/i);
  assert.match(html, /<title>입시 컨설팅<\/title>/i);
  assert.match(html, /src="\/admissions-web\/renderer\/index\.html"/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
});

test("wires the DATA CORE content automation hub", async () => {
  const [
    dataCoreIndex,
    contentHtml,
    contentScript,
    contentStyles,
    router,
    api,
    ciWorkflow,
  ] = await Promise.all([
    readFile(new URL("../public/data-core/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/content.html", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/content.js", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/content.css", import.meta.url), "utf8"),
    readFile(new URL("../worker/router.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/data-core-content.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/data-core-ci.yml", import.meta.url), "utf8"),
  ]);

  assert.match(dataCoreIndex, /href="\/data-core\/content"/);
  assert.match(contentHtml, /data-source-tab="blog"/);
  assert.match(contentHtml, /data-source-tab="instagram"/);
  assert.match(contentHtml, /content\.css/);
  assert.match(contentHtml, /content\.js/);
  assert.match(contentScript, /\/api\/data-core\/content/);
  assert.match(contentScript, /\/api\/data-core\/files/);
  assert.match(contentHtml, /2160\s*[×x]\s*2700/);
  assert.match(contentStyles, /\.content-workspace/);
  assert.match(router, /\/data-core\/content\/blog/);
  assert.match(router, /handleContentApi/);
  assert.match(api, /export async function createContentDraft/);
  assert.match(api, /recordTypeForSource/);
  assert.match(api, /relatedFileIds/);
  assert.match(ciWorkflow, /node --check public\/data-core\/content\.js/);
});
