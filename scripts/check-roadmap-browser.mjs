import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.ROADMAP_TEST_ORIGIN || 'http://localhost:3107';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Synthetic browser tests require a local origin.');
const output = path.resolve('outputs/roadmap-browser');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.ROADMAP_BROWSER_CHANNEL ? { channel: process.env.ROADMAP_BROWSER_CHANNEL } : {}) });
const errors = [];
let checks = 0;
try {
  const context = await browser.newContext();
  let auth = false;
  let holdWebtoon = false;
  let releaseWebtoon;
  let webtoonStarted;
  let announceWebtoon;
  const privateMarkers = ['SYNTHETIC_PRIVATE_NAME', 'SYNTHETIC_PRIVATE_PHONE'];
  await context.route('**/api/data-core/roadmap**', async (route) => {
    const url = new URL(route.request().url());
    if (!auth) return route.fulfill({ status: 401, json: { error: 'Authentication required' } });
    if (url.pathname.endsWith('/goals')) return route.fulfill({ json: { goals: [
      { id: 'career-webtoon', name: '웹툰 작가', nodeType: 'career' },
      { id: 'career-visual', name: '시각 디자이너', nodeType: 'career' },
    ] } });
    const visual = url.searchParams.get('careerId') === 'D017';
    if (!visual && holdWebtoon) {
      announceWebtoon();
      await new Promise((resolve) => { releaseWebtoon = resolve; });
    }
    const metadata = { universityName: '합성 검증대학', major: visual ? '시각디자인학과' : '웹툰학과', region: '서울', schoolType: '4년제', year: '2027', admission: '수시', gradeRatio: 30, skillRatio: 70, officialSourceUrl: 'https://example.edu/guide.pdf', verifiedAt: '2026-09-03', verificationStatus: 'approved', practicalType: '포트폴리오', studentName: privateMarkers[0], guardianPhone: privateMarkers[1] };
    return route.fulfill({ json: { programs: [
      { id: 'synthetic-1', metadata: {...metadata, sourceUniversityId:'synthetic-school-1'} },
      { id: 'synthetic-2', metadata: { ...metadata, universityName: '<img src=x onerror=alert(1)>', region: '부산', verificationStatus: 'pending', gradeRatio: 99, skillRatio: 1 } },
    ] } }).catch(() => {});
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const noOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const overflowing = await page.locator('.dream-copy,.family-copy,.primary-button,.secondary-button').evaluateAll((els) => els.filter((el) => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).length);
    assert.equal(overflowing, 0);
    checks++;
  };
  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844], ['small-mobile', 320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + '/data-core/roadmap');
    await page.locator('.family-card').first().waitFor();
    assert.equal(await page.locator('.family-card:visible').count(), 2);
    assert.equal(await page.locator('.dream-card:visible').count(), 0);
    assert.ok(await page.locator('.hero img').evaluate((img) => img.complete && img.naturalWidth > 0));
    assert.ok(await page.evaluate(async () => { const img = new Image(); img.src = '/data-core/assets/roadmap-careers-v1.png'; await img.decode(); return img.naturalWidth > 1000; }));
    if (width < 680) {
      const boxes = await page.locator('.family-card').evaluateAll((els) => els.map((el) => ({ y: el.getBoundingClientRect().y, x: el.getBoundingClientRect().x })));
      assert.equal(boxes[0].x, boxes[1].x);
      assert.ok(boxes[1].y > boxes[0].y);
    }
    await noOverflow();
    await page.screenshot({ path: path.join(output, `${name}-home.png`), fullPage: true });
    await page.locator('a[href="#family=story"]').click();
    await page.locator('.dream-card').first().waitFor();
    assert.equal(await page.locator('.dream-card:visible').count(), 16);
    for (const img of await page.locator('.dream-card img.job-image').all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate((el) => el.decode());
      assert.ok(await img.evaluate((el) => el.naturalWidth === 600 && el.naturalHeight === 800));
    }
    await page.evaluate(() => scrollTo(0, 0));
    await noOverflow();
    await page.screenshot({ path: path.join(output, `${name}-careers.png`), fullPage: true });
    await page.locator('a[href="#family=story&career=D001"]').click();
    await page.getByRole('link', { name: '교직원 로그인', exact: true }).waitFor();
    assert.equal(await page.locator('#resultGoal').textContent(), '웹툰 작가');
    assert.ok((await page.locator('#careerOutcome').textContent()).includes('단편 웹툰'));
    assert.equal(await page.locator('.timeline li').count(), 6);
    assert.equal(await page.locator('.preparation-item').count(), 4);
    assert.equal(await page.locator('.bar-row').count(), 0);
    await noOverflow();
    await page.screenshot({ path: path.join(output, `${name}-detail.png`), fullPage: true });
    await page.goBack();
    await page.locator('#catalogSection:visible').waitFor();
    await page.goForward();
    await page.locator('#roadmapResult:visible').waitFor();
    await page.reload();
    await page.locator('#resultGoal').filter({ hasText: '웹툰 작가' }).waitFor();
    checks += 10;
  }
  await page.goto(base + '/data-core/roadmap#family=design');
  await page.locator('.dream-card').first().waitFor();
  assert.equal(await page.locator('.dream-card').count(), 19);
  for (const img of await page.locator('.dream-card img.job-image').all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((el) => el.decode());
    assert.ok(await img.evaluate((el) => el.naturalWidth === 600 && el.naturalHeight === 800));
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'design-careers.png'), fullPage: true });
  await page.locator('#goalSearchInput').fill('UI·UX');
  assert.equal(await page.locator('.dream-card').count(), 1);
  await page.locator('#goalSearchInput').fill('존재하지않는직업');
  await page.getByText('검색된 꿈이 없어요.', { exact: false }).waitFor();
  await page.locator('#goalSearchInput').fill('');
  auth = true;
  await page.locator('a[href="#family=design&career=D017"]').click();
  await page.locator('.university-item').first().waitFor();
  assert.equal(await page.locator('.university-item').count(), 2);
  assert.equal(await page.locator('.university-source-link').getAttribute('href'), '/#page=admin&university=synthetic-school-1');
  assert.equal(await page.locator('.bar-row').count(), 2);
  assert.equal(await page.locator('#universityContent img').count(), 0);
  assert.doesNotMatch(await page.locator('#roadmapResult').innerText(), /SYNTHETIC_PRIVATE|99%/);
  await page.selectOption('#regionFilter', '서울');
  assert.equal(await page.locator('.university-item').count(), 1);
  await page.selectOption('#focusFilter', 'academic');
  await page.getByText('선택한 조건에 해당하는 전형이 없습니다.').waitFor();
  await page.selectOption('#focusFilter', 'practical');
  assert.equal(await page.locator('.university-item').count(), 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(output, 'desktop-authenticated.png'), fullPage: true });
  checks += 10;
  holdWebtoon = true;
  webtoonStarted = new Promise((resolve) => { announceWebtoon = resolve; });
  await page.goto(base + '/data-core/roadmap#family=story&career=D001');
  await webtoonStarted;
  await page.waitForTimeout(16000);
  assert.match(await page.locator('#notice').textContent(), /확인하고 있습니다/);
  releaseWebtoon();
  holdWebtoon = false;
  await page.locator('.university-item').first().waitFor();
  assert.equal(await page.locator('#notice').isVisible(), false);
  checks += 2;
  holdWebtoon = true;
  webtoonStarted = new Promise((resolve) => { announceWebtoon = resolve; });
  await page.reload();
  await webtoonStarted;
  await page.evaluate(() => { location.hash = 'family=design&career=D017'; });
  await page.locator('.department').filter({ hasText: '시각디자인학과' }).first().waitFor();
  releaseWebtoon();
  holdWebtoon = false;
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#resultGoal').textContent(), '시각 디자이너');
  assert.doesNotMatch(await page.locator('#universityContent').innerText(), /웹툰학과/);
  auth = false;
  await page.reload();
  await page.getByRole('link', { name: '교직원 로그인', exact: true }).waitFor();
  assert.equal(await page.locator('.university-item').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  auth = true;
  checks += 4;
  const ids = await page.evaluate(() => window.HI5_ROADMAP_CONTENT.careers.map((c) => ({ id: c.id, family: c.family, name: c.name })));
  for (const c of ids) {
    await page.goto(`${base}/data-core/roadmap#family=${c.family}&career=${c.id}`);
    await page.locator('#resultGoal').filter({ hasText: c.name }).waitFor();
    assert.equal(await page.locator('.preparation-item').count(), 4);
    checks++;
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks, pageErrors: errors.length, screenshots: output }));
} finally { await browser.close(); }
