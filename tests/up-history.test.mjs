import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync('public/data-core/up-history.js', 'utf8');

// A tiny browser: one tab's session history (entries + index), location, popstate and reloads.
function browser(start, { framed = false } = {}) {
  const ORIGIN = 'https://hi5.test';
  const entries = [{ url: new URL(start, ORIGIN).href, state: null }];
  let index = 0, reloads = 0;
  const listeners = { popstate: [], hashchange: [] };
  const current = () => new URL(entries[index].url);
  const location = {
    get href() { return current().href; }, get pathname() { return current().pathname; }, get search() { return current().search; },
    get hash() { return current().hash; }, origin: ORIGIN, reload() { reloads += 1; },
  };
  const history = {
    get state() { return entries[index].state; }, get length() { return entries.length; },
    pushState(state, _title, url) { entries.splice(index + 1); entries.push({ url: url == null ? entries[index].url : new URL(url, location.href).href, state: structuredClone(state) }); index += 1; },
    replaceState(state, _title, url) { entries[index] = { url: url == null ? entries[index].url : new URL(url, location.href).href, state: structuredClone(state) }; },
  };
  const window = {
    location, history, top: null,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { for (const fn of listeners[event.type] || []) fn(event); },
  };
  window.top = framed ? {} : window;
  const context = vm.createContext({ window, history, location, URL, URLSearchParams, document: { addEventListener() {} }, HashChangeEvent: class { constructor(type) { this.type = type; } } });
  vm.runInContext(source, context);
  const back = () => {
    if (index === 0) return false;
    index -= 1;
    let stopped = false;
    const event = { type: 'popstate', stopImmediatePropagation() { stopped = true; } };
    for (const fn of listeners.popstate) { if (stopped) break; fn(event); }
    return true;
  };
  const go = url => context.history.pushState({}, '', url); // what the screens do when you click
  const here = () => { const u = current(); return u.pathname + u.search + u.hash; };
  return { context, back, go, here, entries, get reloads() { return reloads; }, api: () => context.window.DataCoreUpHistory };
}

test('수업 쪽을 넘긴 뒤 뒤로가기 → 과정 목록, 그다음 한 단계씩 위로', () => {
  const b = browser('/data-core/curriculum/content/basic');
  b.go('/data-core/curriculum/content/basic?lesson=L13');
  b.go('/data-core/curriculum/content/basic?lesson=L13&slide=2');
  b.go('/data-core/curriculum/content/basic?lesson=L13&slide=3');
  assert.equal(b.here(), '/data-core/curriculum/content/basic?lesson=L13&slide=3');
  b.back(); assert.equal(b.here(), '/data-core/curriculum/content/basic', '3쪽 → 기초과정 (not 2쪽)');
  b.back(); assert.equal(b.here(), '/data-core/curriculum/content');
  b.back(); assert.equal(b.here(), '/data-core/curriculum');
  b.back(); assert.equal(b.here(), '/data-core/counseling');
  b.back(); assert.equal(b.here(), '/data-core');
  assert.equal(b.back(), false, 'the top screen has nothing above it');
});

test('a lesson opened straight from an address or link still goes back to its 과정', () => {
  const b = browser('/data-core/curriculum/content/basic?lesson=L13&slide=3');
  b.back(); assert.equal(b.here(), '/data-core/curriculum/content/basic');
});

test('같은 단계 이동은 기록을 쌓지 않고, 다른 과정으로 건너뛰면 그 과정이 바로 뒤에 놓인다', () => {
  const b = browser('/data-core/curriculum/content/basic?lesson=A');
  const length = b.entries.length;
  b.go('/data-core/curriculum/content/basic?lesson=B');
  assert.equal(b.entries.length, length, 'another lesson of the same 과정 replaces');
  b.go('/data-core/curriculum/design/advanced?lesson=C');
  b.back(); assert.equal(b.here(), '/data-core/curriculum/design/advanced');
  b.back(); assert.equal(b.here(), '/data-core/curriculum/design');
});

test('자료보관함 · 수상작 폴더: 폴더는 상위 폴더로, 위치를 모르는 동안 넣어 둔 상위도 뒤로갈 때 바로잡힌다', () => {
  const b = browser('/data-core/work/library');
  const parents = { child: 'mid', mid: null };
  b.api().resolve(url => {
    if (url.pathname !== '/data-core/work/library' || !url.searchParams.get('folder')) return undefined;
    const id = url.searchParams.get('folder');
    if (!(id in parents)) return undefined;
    return parents[id] ? `/data-core/work/library?folder=${parents[id]}` : '/data-core/work/library';
  });
  b.go('/data-core/work/library?folder=mid');
  b.go('/data-core/work/library?folder=child');
  b.go('/data-core/work/library?folder=child&page=2');
  b.back(); assert.equal(b.here(), '/data-core/work/library?folder=mid');
  b.back(); assert.equal(b.here(), '/data-core/work/library');
  b.back(); assert.equal(b.here(), '/data-core/work');

  // Opened directly: the parent is unknown at first (address rule), then known when going back.
  const c = browser('/data-core/work/library?folder=deep');
  const known = {};
  c.api().resolve(url => (url.searchParams.get('folder') in known ? `/data-core/work/library?folder=${known[url.searchParams.get('folder')]}` : undefined));
  known.deep = 'up';
  c.back(); assert.equal(c.here(), '/data-core/work/library?folder=up');
});

test('다른 페이지가 상위면 그 페이지를 새로 연다 (꿈이음 → 업무용 홈), 탭끼리는 같은 단계', () => {
  const b = browser('/data-core/kkumeum?tab=kids-news');
  const length = b.entries.length;
  b.go('/data-core/kkumeum?tab=class-news');
  assert.equal(b.entries.length, length);
  b.go('/data-core/kkumeum?tab=class-news&view=attendance');
  b.go('/data-core/kkumeum?tab=class-news&view=attendance-settings');
  b.back(); assert.equal(b.here(), '/data-core/kkumeum?tab=class-news&view=attendance');
  b.back(); assert.equal(b.here(), '/data-core/kkumeum?tab=class-news');
  assert.equal(b.reloads, 0);
  b.back(); assert.equal(b.here(), '/data-core/work'); assert.equal(b.reloads, 1, '업무용 홈 is another page, so it loads');
});

test('꿈·전공 로드맵 · 수상작 화면 주소 규칙, 그리고 다른 화면 안(로드맵 프레임)에서는 기록을 쌓지 않는다', () => {
  const r = browser('/data-core/roadmap#family=story&career=webtoon');
  r.back(); assert.equal(r.here(), '/data-core/roadmap#family=story');
  r.back(); assert.equal(r.here(), '/data-core/roadmap');
  const a = browser('/data-core/counseling/works');
  a.go('/data-core/counseling/works?admittedAwardFolder=X&awardFolder=X');
  a.back(); assert.equal(a.here(), '/data-core/counseling/works');
  a.back(); assert.equal(a.here(), '/data-core/counseling');
  const framed = browser('/data-core/counseling/works?embed=1', { framed: true });
  const length = framed.entries.length;
  framed.go('/data-core/counseling/works?embed=1&admittedAwardFolder=X&awardFolder=X');
  assert.equal(framed.entries.length, length, 'the 대학 합격 로드맵 back button stays the roadmap’s');
});

test('every DATA CORE page loads the rule first, and the folder screens register their parents', () => {
  for (const page of ['index.html', 'content.html', 'reports.html', 'accounts.html', 'operations.html', 'work/kkumeum.html', 'roadmap.html']) {
    const html = fs.readFileSync(`public/data-core/${page}`, 'utf8');
    const at = html.indexOf('/data-core/up-history.js'), firstOther = html.search(/<script(?![^>]*(up-history|phone-entry|fetch-share))/);
    assert.ok(at > 0 && at < firstOther, `${page} loads up-history.js before other scripts`);
  }
  assert.match(fs.readFileSync('public/data-core/app.js', 'utf8'), /DataCoreUpHistory\?\.resolve\(url => \{\r?\n {2}const id = url\.searchParams\.get\('awardFolder'\)/);
  assert.match(fs.readFileSync('public/data-core/work/hq-library.js', 'utf8'), /DataCoreUpHistory\?\.resolve/);
  assert.match(fs.readFileSync('public/data-core/work/kkumeum-talk.js', 'utf8'), /DataCoreUpHistory\?\.resolve/);
  const roadmap = fs.readFileSync('public/admissions-web/renderer/app.js', 'utf8');
  assert.match(roadmap, /function pushAdmissionsPage\(page\)/); assert.match(roadmap, /settleAdmissionsPage\(\);/);
});
