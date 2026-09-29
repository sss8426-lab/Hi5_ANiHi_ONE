import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/data-core/award-slideshow.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const nodes = new Map(), requests = [], changes = [], opens = [];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      isConnected: true, hidden: false, textContent: '', tagName: 'DIV',
      querySelector: sub => node(selector + ' ' + sub),
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      setPointerCapture() {}, decode: async () => {},
    });
    return nodes.get(selector);
  };
  const host = {hidden: true, querySelector: node, replaceChildren() {
    for (const item of nodes.values()) item.isConnected = false;
    nodes.clear();
  }};
  const cache = {blocked: false, get(id, options) {
    return new Promise((resolve, reject) => requests.push({id, options, resolve, reject}));
  }};
  const context = vm.createContext({host, options: {cache, onChange: id => changes.push(id), onOpen: index => opens.push(index)}});
  const viewer = vm.runInContext(source + '\nnew AwardSlideshow(host, options)', context);
  const items = [{id:'a',fileName:'<img onerror=alert(1)>.png'}, {id:'b',fileName:'한글 B.png'}];
  const key = (key, tagName = 'DIV') => viewer.keydown({key, target:{tagName}, preventDefault() {}, stopPropagation() {}});
  return {viewer, host, node, cache, requests, changes, opens, items, key};
}

test('folder starts at first image; arrows, keyboard and thumbnails share selection without writes', async () => {
  const h = harness(); h.viewer.render(h.items, '폴더');
  assert.equal(h.requests[0].id, 'a'); assert.equal(h.requests[0].options.priority, true);
  h.requests[0].resolve('blob:a'); await tick();
  assert.equal(h.node('img').hidden, false);
  assert.equal(h.node('img').alt, h.items[0].fileName);
  assert.equal(h.node('.award-slide-caption').textContent, h.items[0].fileName);
  assert.equal(h.node('[data-slide-prev]').disabled, true);
  h.key('ArrowRight'); assert.equal(h.node('output').textContent, '2 / 2');
  assert.equal(h.node('img').hidden, true); assert.equal(h.node('img').src, undefined);
  h.key('ArrowLeft', 'INPUT'); assert.equal(h.viewer.index, 1);
  h.key('Home'); assert.equal(h.viewer.index, 0);
  h.key('End'); assert.equal(h.viewer.index, 1);
  h.viewer.move(1); assert.equal(h.viewer.index, 1);
  h.node('[data-slide-open]').onclick(); assert.deepEqual(h.opens, [1]);
});

test('late success and failure cannot replace the currently selected picture', async () => {
  const h = harness(); h.viewer.render(h.items, '폴더'); h.viewer.move(1);
  h.requests[1].resolve('blob:b'); await tick();
  h.requests[0].reject(new Error('old failure')); await tick();
  assert.equal(h.node('img').src, 'blob:b'); assert.equal(h.node('img').hidden, false);
  assert.equal(h.node('.award-slide-feedback').hidden, true);
  h.viewer.render(h.items, '다른 폴더'); h.viewer.move(1);
  h.requests[2].resolve('blob:old-a'); await tick();
  assert.equal(h.node('img').src, undefined);
  h.requests[3].resolve('blob:new-b'); await tick(); assert.equal(h.node('img').src, 'blob:new-b');
});

test('clear cancels rendering of a pending image and empty/single folders have correct controls', async () => {
  const h = harness(); h.viewer.render(h.items, '폴더'); h.viewer.clear();
  h.requests[0].resolve('blob:old'); await tick(); assert.equal(h.host.hidden, true);
  h.viewer.render([], '빈 폴더'); assert.equal(h.host.hidden, true);
  h.viewer.render(h.items.slice(0, 1), '한 장');
  assert.equal(h.node('output').textContent, '1 / 1');
  assert.equal(h.node('[data-slide-prev]').disabled, true); assert.equal(h.node('[data-slide-next]').disabled, true);
});

test('network or decoding failure offers retry; authorization denial does not offer bypass', async () => {
  const h = harness(); h.viewer.render(h.items, '폴더');
  h.requests[0].reject(new Error('network')); await tick();
  assert.equal(h.node('[data-slide-retry]').hidden, false); assert.equal(h.node('[data-slide-open]').disabled, true);
  h.node('[data-slide-retry]').onclick(); h.requests[1].resolve('blob:retry'); await tick();
  assert.equal(h.node('img').hidden, false);
  h.node('img').decode = async () => { throw new Error('invalid image'); };
  h.viewer.move(1); h.requests[2].resolve('blob:broken'); await tick();
  assert.equal(h.node('[data-slide-retry]').hidden, false); assert.equal(h.node('img').src, undefined);
  h.cache.blocked = true; h.node('[data-slide-retry]').onclick(); h.requests[3].reject(new Error('403')); await tick();
  assert.equal(h.node('[data-slide-retry]').hidden, true);
});

test('30 folder changes do not accumulate handlers; horizontal swipe works but scrolling and pinch do not turn pages', () => {
  const h = harness(); for (let i=0;i<30;i++) h.viewer.render(h.items, '폴더 '+i);
  const stage = h.node('.award-slide-stage');
  const point = (id,x,y) => ({pointerId:id,button:0,clientX:x,clientY:y,target:{closest:()=>null}});
  stage.onpointerdown(point(1,200,100)); stage.onpointerup(point(1,100,100));
  assert.equal(h.viewer.index, 1); assert.equal(h.requests.length, 31);
  stage.onpointerdown(point(1,100,100)); stage.onpointerup(point(1,200,300)); assert.equal(h.viewer.index, 1);
  stage.onpointerdown(point(1,100,100)); stage.onpointerdown(point(2,100,100));
  stage.onpointerup(point(1,200,100)); stage.onpointerup(point(2,200,100)); assert.equal(h.viewer.index, 1);
});
