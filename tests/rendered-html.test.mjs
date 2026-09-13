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

function section(html, marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  const rest = html.slice(start);
  const end = rest.indexOf("</section>");
  assert.notEqual(end, -1, `${marker} section should close`);
  return rest.slice(0, end);
}

test("server-renders the admissions web shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko"/i);
  assert.match(html, /<title>대학 합격 로드맵<\/title>/i);
  assert.match(html, /src="\/admissions-web\/renderer\/index\.html"/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
});

test("wires the DATA CORE counseling and work mode split", async () => {
  const [
    dataCoreIndex,
    appScript,
    styles,
    router,
    counselingAsset,
    workAsset,
  ] = await Promise.all([
    readFile(new URL("../public/data-core/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../worker/router.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/assets/work-visuals/story-v1.webp", import.meta.url)),
    readFile(new URL("../public/data-core/assets/work-visuals/operations-v1.webp", import.meta.url)),
  ]);

  assert.match(dataCoreIndex, /data-mode-card="counseling"/);
  assert.match(dataCoreIndex, /data-mode-card="work"/);
  assert.match(dataCoreIndex, /href="\/data-core\/counseling"/);
  assert.match(dataCoreIndex, /href="\/data-core\/work"/);
  assert.match(dataCoreIndex, /data-nav-scope="counseling"/);
  assert.match(dataCoreIndex, /data-nav-scope="work"/);
  assert.match(dataCoreIndex, /data-nav-scope="admin"/);
  assert.match(dataCoreIndex, /data-core\/assets\/work-visuals\/story-v1\.webp/);
  assert.match(dataCoreIndex, /data-core\/assets\/work-visuals\/operations-v1\.webp/);
  assert.ok(counselingAsset.byteLength > 1_000);
  assert.ok(workAsset.byteLength > 1_000);
  assert.equal(counselingAsset.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(workAsset.subarray(0, 4).toString("ascii"), "RIFF");

  const counselingMenu = section(dataCoreIndex, 'aria-label="진로와 진학"');
  assert.match(counselingMenu, /공모전·실기대회/);
  assert.match(counselingMenu, /꿈·전공 로드맵/);
  assert.match(counselingMenu, /대학합격 로드맵/);
  assert.doesNotMatch(counselingMenu, /자료보관함|블로그 자동화|인스타 자동화/);

  const workMenu = section(dataCoreIndex, 'aria-label="업무용 메뉴"');
  assert.match(workMenu, /자료보관함/);
  assert.match(workMenu, /블로그 자동화/);
  assert.match(workMenu, /인스타 자동화/);
  assert.doesNotMatch(workMenu, /공모전·실기대회|꿈·전공 로드맵|대학합격 로드맵/);

  assert.match(appScript, /orderedCampuses\(\)/);
  assert.match(appScript, /data-campus-folder/);
  assert.match(appScript, /LIBRARY_CATEGORIES/);
  assert.match(appScript, /data-folder-source/);
  assert.match(appScript, /data-folder-key/);
  assert.match(appScript, /LIBRARY_CATEGORIES/);
  assert.match(appScript, /부천 디자인 입시관/);
  assert.match(appScript, /서울 광진 입시관/);
  assert.match(appScript, /data-campus-group/);
  assert.match(dataCoreIndex, /app\.js\?v=20260913-brand-home/);
  assert.match(appScript, /params\.set\('sourceApp', sourceApp\)/);
  assert.match(appScript, /fileCategoryFilter/);
  assert.match(appScript, /loadFiles\(\)/);
  assert.match(appScript, /isSuperAdmin\(\) && state\.currentMode !== 'mode'/);
  assert.match(dataCoreIndex, /data-calendar-home="counseling"/);
  assert.match(dataCoreIndex, /data-calendar-home="work"/);
  assert.match(dataCoreIndex, /data-calendar-prev/);
  assert.match(dataCoreIndex, /data-calendar-add/);
  assert.match(appScript, /\/api\/data-core\/calendar/);
  assert.match(appScript, /calendarRange\(\)/);
  assert.match(appScript, /calendarSelectedDate/);
  assert.match(styles, /\.calendar-grid/);
  assert.match(styles, /\.calendar-day/);
  assert.match(styles, /\.mode-card/);
  assert.match(styles, /\.competition-split/);
  assert.match(router, /\/data-core\/counseling/);
  assert.match(router, /\/data-core\/work/);

  const uploadFormStart = dataCoreIndex.indexOf('<form id="uploadForm"');
  const uploadFormEnd = dataCoreIndex.indexOf("</form>", uploadFormStart);
  const uploadForm = dataCoreIndex.slice(uploadFormStart, uploadFormEnd);
  assert.doesNotMatch(uploadForm, /uploadArea|자료 영역/);
  assert.deepEqual(
    [...uploadForm.matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]),
    [
      "class-photo",
      "student-artwork",
      "academy-photo",
      "competition-material",
      "admission-material",
      "counseling-material",
      "blog-source",
      "instagram-source",
      "promotion-material",
    ],
  );
});

test("wires DATA CORE competition media and academy guide draft interactions", async () => {
  const [dataCoreIndex, appScript, styles, filesApi] = await Promise.all([
    readFile(new URL("../public/data-core/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../worker/data-core-files.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dataCoreIndex, /selectedFolderNotice/);
  assert.match(appScript, /recordId=.*sourceApp=competition/);
  assert.match(appScript, /renderCompetitionPoster/);
  assert.match(appScript, /renderCompetitionAwardFiles/);
  assert.match(appScript, /competition-media-empty/);
  assert.match(appScript, /안내문 초안 만들기/);
  assert.match(appScript, /competitionGuideTemplate/);
  assert.match(appScript, /navigator\.clipboard/);
  assert.match(styles, /\.award-file-grid/);
  assert.match(styles, /\.competition-media-empty/);
  assert.match(filesApi, /const sourceApp = cleanText\(url\.searchParams\.get\("sourceApp"\), 80\)/);
  assert.match(filesApi, /conditions\.push\("fo\.source_app = \?"\)/);
});

test("competition source panel is always visible with one refresh", async () => {
  const html = await readFile(new URL("../public/data-core/index.html", import.meta.url), "utf8");
  const appScript = await readFile(new URL("../public/data-core/app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../public/data-core/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /competitionSearchInput/);
  assert.match(html, /refreshCompetitionSourcesBtn/);
  assert.match(html, /<h3>공모전 소식<\/h3>/);
  assert.doesNotMatch(html, /hideCompetitionNewsBtn|showCompetitionNewsBtn/);
  assert.match(appScript, /competition-sources\/\$\{encodeURIComponent\(source\)\}\/preview/);
  assert.match(appScript, /competition-sources\/\$\{encodeURIComponent\(source\)\}\/import/);
  assert.doesNotMatch(styles, /competition-workspace\.news-closed|competition-news\.hidden/);
});

test("wires counseling competition folders to existing DATA CORE records and files", async () => {
  const [dataCoreIndex, appScript, styles, admissionsHtml] = await Promise.all([
    readFile(new URL("../public/data-core/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/data-core/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/admissions-web/renderer/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(dataCoreIndex, /공모전 및 실기대회 수상작/);
  assert.match(dataCoreIndex, /awardFolderForm/);
  assert.match(dataCoreIndex, /openAwardUploadBtn/);
  assert.match(dataCoreIndex, /uploadRecordId/);
  assert.match(dataCoreIndex, /id="uploadFile" type="file" multiple/);
  assert.match(appScript, /competition-award-folder/);
  assert.match(appScript, /\/api\/data-core\/records/);
  assert.match(appScript, /recordId=.*category=competition-material/);
  assert.match(appScript, /applicationDday/);
  assert.match(styles, /\.award-library-grid/);
  assert.match(admissionsHtml, /<title>대학 합격 로드맵<\/title>/);
  assert.doesNotMatch(admissionsHtml, /data-page="awards">공모전 및 실기대회 수상작/);
});

test("wires the DATA CORE blog and Instagram automation routes", async () => {
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

  assert.match(dataCoreIndex, /href="\/data-core\/content\/blog"/);
  assert.match(dataCoreIndex, /href="\/data-core\/content\/instagram"/);
  assert.doesNotMatch(dataCoreIndex, /콘텐츠 허브/);
  assert.match(contentHtml, /data-content-nav="blog"/);
  assert.match(contentHtml, /data-content-nav="instagram"/);
  assert.match(contentHtml, /블로그 자동화/);
  assert.match(contentHtml, /인스타 자동화/);
  assert.doesNotMatch(contentHtml, /콘텐츠 허브/);
  assert.match(contentHtml, /content\.css/);
  assert.match(contentHtml, /content\.js/);
  assert.match(contentScript, /contentPageTitle/);
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
