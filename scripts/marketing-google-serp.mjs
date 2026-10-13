// Google 광고 · 자연검색 · 지도를 SerpApi 공식 검색결과 API로 받아 보고서 JSON의 platforms.google을 채운다.
// Google은 자동화 브라우저 검색을 로봇 확인 화면으로 막으므로(2026-10-13 확인) 브라우저로 수집하지 않고, 로봇 확인도 우회하지 않는다.
//
//   키 저장(한 번):  node scripts/marketing-google-serp.mjs configure --key-file "..\.monitoring\secrets\serpapi.dpapi"
//   보고서에 추가:   node scripts/marketing-google-serp.mjs merge --payload "report.json" --key-file "..\.monitoring\secrets\serpapi.dpapi"
//
// merge는 PNG를 만들기 전에 실행한다. 이미 Google이 관찰된 보고서는 건드리지 않는다(같은 runId 재전송 409 방지).
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dpapi } from './marketing-collector.mjs';
import { REPORT_KEYWORDS } from './render-marketing-report.mjs';

export const SERPAPI_URL = 'https://serpapi.com/search.json';
export const GOOGLE_LOCATION = 'Bucheon-si,Gyeonggi-do,South Korea';
const SHARED_HOSTS = ['blog.naver.com', 'cafe.naver.com', 'instagram.com', 'youtube.com', 'facebook.com', 'tiktok.com', 'threads.net', 'x.com', 'twitter.com'];

const bareHost = host => host.toLowerCase().replace(/^(www|m)\./, '');

// 공식 채널 = 보고서 channels(블로그·인스타·웹사이트) 주소 + --official 로 더한 주소.
// 블로그·인스타처럼 여러 사람이 쓰는 사이트는 계정 경로까지, 자체 홈페이지는 도메인 전체를 공식으로 본다.
export function officialMatchers(payload, extra = []) {
  const urls = [...['blog', 'instagram', 'website'].map(k => payload?.channels?.[k]?.url), ...extra].filter(v => typeof v === 'string' && v.trim());
  const out = [];
  for (const value of urls) {
    let url; try { url = new URL(value); } catch { continue; }
    const host = bareHost(url.hostname);
    const shared = SHARED_HOSTS.includes(host);
    const path = shared ? url.pathname.replace(/\/+$/, '').toLowerCase() : '';
    if (shared && !path) continue;
    if (!out.some(m => m.host === host && m.path === path)) out.push({ host, path });
  }
  return out;
}

export function isOfficial(value, matchers) {
  let url; try { url = new URL(value); } catch { return false; }
  const host = bareHost(url.hostname), path = url.pathname.toLowerCase();
  return matchers.some(m => {
    if (m.path) {
      if (host !== m.host) return false;
      if (path === m.path || path.startsWith(m.path + '/')) return true;
      // blog.naver.com/PostView.naver?blogId=아이디 형태
      const id = url.searchParams.get('blogId');
      return Boolean(id) && '/' + id.toLowerCase() === m.path;
    }
    return host === m.host || host.endsWith('.' + m.host);
  });
}

export function googleSearchUrl(keyword) {
  return 'https://www.google.com/search?' + new URLSearchParams({ q: keyword, hl: 'ko', gl: 'kr' });
}

// SerpApi 응답에서 판정에 필요한 링크만 남긴다(캐시에도 이 형태만 저장).
export function summarizeSerp(raw) {
  const links = list => (Array.isArray(list) ? list : []).map(x => (typeof x?.link === 'string' ? x.link : '')).filter(Boolean);
  const places = Array.isArray(raw?.local_results?.places) ? raw.local_results.places : Array.isArray(raw?.local_results) ? raw.local_results : [];
  return {
    ads: links(raw?.ads),
    organic: links(raw?.organic_results),
    places: places.map((p, i) => ({ position: Number.isInteger(p?.position) && p.position > 0 ? p.position : i + 1, title: String(p?.title || ''), website: typeof p?.links?.website === 'string' ? p.links.website : typeof p?.website === 'string' ? p.website : '' })),
    hasLocalPack: places.length > 0,
  };
}

export function keywordResult(keyword, s, matchers) {
  const adIndex = s.ads.findIndex(link => isOfficial(link, matchers));
  const officialLinks = s.organic.filter(link => isOfficial(link, matchers));
  const organicIndex = s.organic.findIndex(link => isOfficial(link, matchers));
  return {
    keyword,
    adCount: s.ads.length,
    adStatus: s.ads.length === 0 ? 'not_observed' : adIndex >= 0 ? 'observed' : 'not_exposed',
    adRank: adIndex >= 0 ? adIndex + 1 : null,
    organicRank: organicIndex >= 0 ? organicIndex + 1 : null,
    officialDocuments: officialLinks.length,
    inspectedResults: s.organic.length,
    sourceUrls: [googleSearchUrl(keyword), ...officialLinks.slice(0, 5)],
  };
}

export function mapsItem(keyword, s, matchers, placeNames = []) {
  if (!s.hasLocalPack) return { keyword, status: 'not_observed', rank: null, sourceUrls: [] };
  const names = placeNames.map(n => n.trim()).filter(Boolean);
  const ours = s.places.find(p => (p.website && isOfficial(p.website, matchers)) || names.some(n => p.title.includes(n)));
  return ours ? { keyword, status: 'observed', rank: ours.position, sourceUrls: [googleSearchUrl(keyword)] } : { keyword, status: 'not_exposed', rank: null, sourceUrls: [googleSearchUrl(keyword)] };
}

async function searchOnce(keyword, apiKey, request) {
  const params = new URLSearchParams({ engine: 'google', q: keyword, location: GOOGLE_LOCATION, google_domain: 'google.co.kr', gl: 'kr', hl: 'ko', device: 'desktop', api_key: apiKey });
  let response;
  try { response = await request(SERPAPI_URL + '?' + params, { signal: AbortSignal.timeout(60_000), redirect: 'error' }); }
  catch { throw Object.assign(new Error('SerpApi 연결 실패'), { retry: true }); }
  // 키가 들어간 주소와 응답 원문은 출력하지 않는다.
  if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw Object.assign(new Error('SerpApi 키를 확인하세요 (' + response.status + ').'), { fatal: true }); }
  if (response.status === 429) { await response.body?.cancel(); throw Object.assign(new Error('SerpApi 사용량(검색 횟수)이 다 찼습니다. 요금제/남은 횟수를 확인하세요.'), { fatal: true }); }
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('SerpApi 일시 오류 (' + response.status + ')'), { retry: true }); }
  const raw = await response.json();
  if (raw?.error && !/hasn't returned any results/i.test(String(raw.error))) throw new Error('SerpApi 검색 실패');
  return summarizeSerp(raw);
}

// 같은 날(KST) 같은 키워드는 한 번만 검색한다. 여러 캠퍼스 보고서가 결과를 함께 쓰므로 비용이 늘지 않는다.
async function cachedSearch(keyword, { apiKey, request, cacheDir, day, pause }) {
  const file = cacheDir ? join(cacheDir, day, encodeURIComponent(keyword) + '.json') : null;
  if (file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* 캐시 없음 */ } }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const summary = await searchOnce(keyword, apiKey, request);
      if (file) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(summary)); }
      return summary;
    } catch (error) {
      lastError = error;
      if (error.fatal || !error.retry) throw error;
      await pause(1500 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function collectGoogle({ payload, apiKey, request = fetch, cacheDir = null, officialUrls = [], placeNames = [], pause = ms => new Promise(done => setTimeout(done, ms)), now = new Date() }) {
  if (!apiKey) throw new Error('SerpApi 키가 필요합니다.');
  const matchers = officialMatchers(payload, officialUrls);
  const day = new Date(now.getTime() + 32400000).toISOString().slice(0, 10);
  const keywords = [], items = [];
  let failed = 0;
  for (const keyword of REPORT_KEYWORDS) {
    try {
      const s = await cachedSearch(keyword, { apiKey, request, cacheDir, day, pause });
      keywords.push(keywordResult(keyword, s, matchers));
      items.push(mapsItem(keyword, s, matchers, placeNames));
    } catch (error) {
      if (error.fatal) throw error;
      failed++;
      keywords.push({ keyword, adCount: null, adStatus: 'unavailable', adRank: null, organicRank: null, officialDocuments: null, inspectedResults: null, sourceUrls: [] });
      items.push({ keyword, status: 'unavailable', rank: null, sourceUrls: [] });
    }
  }
  const observedMaps = items.filter(i => i.status !== 'unavailable');
  return {
    status: failed ? 'partial' : 'observed',
    source: 'serpapi',
    keywords,
    maps: { status: observedMaps.length ? 'observed' : 'unavailable', summary: 'Google 검색 첫 화면의 지도 묶음(로컬팩)에서 우리 학원이 보인 위치입니다.', items },
    note: matchers.length ? undefined : '공식 채널 주소가 없어 우리 학원 글을 찾지 못했습니다. channels 또는 --official 주소를 넣으세요.',
  };
}

export const GOOGLE_LIMITATION = 'Google은 SerpApi 공식 검색결과 API로 부천시 위치 · google.co.kr · 데스크톱 · 첫 화면(자연검색 최대 10건)만 관찰했습니다. 광고는 시간·사용자에 따라 달라질 수 있습니다.';

export async function mergeGoogleIntoPayload({ payloadPath, ...options }) {
  const text = await readFile(payloadPath, 'utf8');
  const payload = JSON.parse(text);
  if (payload.version !== 1 || !payload.platforms?.naver) throw new Error('version 1 보고서 JSON(네이버 포함)이 필요합니다.');
  if (payload.platforms.google?.status === 'observed') return { merged: false, reason: 'already-observed' };
  const google = await collectGoogle({ payload, ...options });
  if (!google.note) delete google.note;
  payload.platforms.google = google;
  payload.limitations = [...(Array.isArray(payload.limitations) ? payload.limitations.filter(l => !String(l).includes('Google은 이번')) : []), GOOGLE_LIMITATION];
  const temp = payloadPath + '.google-tmp';
  await writeFile(temp, JSON.stringify(payload, null, 2));
  await rename(temp, payloadPath);
  return { merged: true, status: google.status, keywords: google.keywords.length, ourOrganic: google.keywords.filter(k => k.organicRank).length };
}

export async function readSerpApiKey(keyFile) {
  if (process.env.SERPAPI_API_KEY) return process.env.SERPAPI_API_KEY.trim();
  if (!keyFile) throw new Error('--key-file 또는 SERPAPI_API_KEY 환경변수가 필요합니다.');
  const bytes = await readFile(keyFile);
  if (bytes.length > 8192) throw new Error('키 파일 형식을 확인하세요.');
  return (await dpapi(bytes, false)).toString('utf8').trim();
}

// 원장님이 직접 키를 붙여 넣는다. 화면에 글자가 보이지 않고, 키는 Windows 사용자 암호화(DPAPI) 파일로만 저장된다.
async function promptHidden(label) {
  const input = process.stdin;
  if (!input.isTTY) { const chunks = []; for await (const c of input) chunks.push(c); return Buffer.concat(chunks).toString('utf8').trim(); }
  process.stdout.write(label);
  input.setRawMode(true); input.resume(); input.setEncoding('utf8');
  return new Promise((done, reject) => {
    let value = '';
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { input.setRawMode(false); input.pause(); input.off('data', onData); process.stdout.write('\n'); return done(value.trim()); }
        if (ch === '\u0003') { input.setRawMode(false); input.pause(); input.off('data', onData); process.stdout.write('\n'); return reject(new Error('취소했습니다.')); }
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1); else value += ch;
      }
    };
    input.on('data', onData);
  });
}

function parseArgs(args) {
  const result = { command: args[0], officialUrls: [], placeNames: [] };
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!value) throw new Error('명령 인자가 누락되었습니다.');
    if (key === '--payload') result.payloadPath = resolve(value);
    else if (key === '--key-file') result.keyFile = resolve(value);
    else if (key === '--cache-dir') result.cacheDir = resolve(value);
    else if (key === '--official') result.officialUrls.push(value);
    else if (key === '--place') result.placeNames.push(value);
    else throw new Error('지원하지 않는 인자입니다: ' + key);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'configure') {
    if (!args.keyFile) throw new Error('--key-file이 필요합니다.');
    const key = await promptHidden('SerpApi 키를 붙여 넣고 Enter (화면에 보이지 않습니다): ');
    if (!/^[A-Za-z0-9]{32,128}$/.test(key)) throw new Error('SerpApi 키 형식이 아닙니다. serpapi.com 대시보드의 Private API Key를 붙여 넣으세요.');
    await mkdir(dirname(args.keyFile), { recursive: true });
    await writeFile(args.keyFile, await dpapi(Buffer.from(key, 'utf8'), true));
    console.log(JSON.stringify({ configured: true, credentialProtection: 'Windows DPAPI CurrentUser' }));
  } else if (args.command === 'merge') {
    if (!args.payloadPath) throw new Error('--payload가 필요합니다.');
    const apiKey = await readSerpApiKey(args.keyFile);
    const cacheDir = args.cacheDir || (args.keyFile ? join(dirname(dirname(args.keyFile)), 'cache', 'serpapi') : null);
    console.log(JSON.stringify(await mergeGoogleIntoPayload({ ...args, apiKey, cacheDir })));
  } else throw new Error('configure 또는 merge 명령을 선택하세요.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
