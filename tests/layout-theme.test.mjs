import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('signed-in DATA CORE staff shells load the shared versioned visual layer after their existing styles',()=>{
  for(const file of ['index','content','accounts','operations','readiness','work/kkumeum']) {
    const html=fs.readFileSync(`public/data-core/${file}.html`,'utf8');
    assert.match(html,/<body class="data-core-layout">/);
    const styles=[...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(match=>match[0]);
    const sharedIndex=styles.findIndex(style=>/layout-theme\.css\?v=20260909-bright-layout/.test(style));
    assert.ok(sharedIndex>0);
    assert.match(styles.at(-1),/design-system\.css\?v=/);
    assert.match(styles.at(-2),/design-tokens\.css\?v=/);
    if(file==='index')assert.ok(styles.some(style=>/counseling-refinements\.css\?v=/.test(style)));
    assert.equal(styles.filter(style=>style.includes('layout-theme.css')).length,1);
  }
});

test('public login uses its isolated editorial layer without changing the staff theme',()=>{
  const html=fs.readFileSync('public/data-core/login.html','utf8');
  assert.match(html,/<body class="login-page">/);
  assert.match(html,/login\.css\?v=20260910-editorial-v1/);
  assert.doesNotMatch(html,/layout-theme\.css/);
});

test('shared visuals retain hidden state, main artwork isolation and existing mode destinations',()=>{
  const css=fs.readFileSync('public/data-core/layout-theme.css','utf8');
  assert.match(css,/\.data-core-layout \[hidden\] \{ display: none !important; \}/);
  assert.match(css,/:not\(\.mode-home-artwork-active\)/);
  assert.match(css,/@media \(max-width: 680px\)/);
  assert.match(css,/prefers-reduced-motion/);
  const html=fs.readFileSync('public/data-core/index.html','utf8');
  for(const mode of ['counseling','work']) assert.match(html,new RegExp(`href="/data-core/${mode}" data-mode-card="${mode}"`));
});
