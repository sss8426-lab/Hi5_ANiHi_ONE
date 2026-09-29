// Inline folder viewer. Original bytes and authorization stay in AwardImageCache.
class AwardSlideshow {
  constructor(host, { cache, onChange, onOpen }) {
    Object.assign(this, { host, cache, onChange, onOpen, revision: 0, items: [], index: -1 });
  }
  clear() {
    this.revision++;
    this.items = [];
    this.index = -1;
    this.host.replaceChildren();
    this.host.hidden = true;
  }
  render(items, title) {
    this.clear();
    if (!items.length) return;
    this.items = items.slice();
    this.host.hidden = false;
    const icon = name => `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"/></svg>`;
    this.host.innerHTML = `<div class="award-slide-toolbar"><output aria-live="polite"></output><button type="button" class="icon-btn" data-slide-open aria-label="수상작 크게 보기" title="수상작 크게 보기">${icon('ZoomIn')}</button></div><div class="award-slide-stage" tabindex="0" role="group"><img alt="" decoding="async" draggable="false" hidden><button type="button" class="icon-btn" data-slide-prev aria-label="이전 수상작" title="이전 수상작">${icon('ChevronLeft')}</button><button type="button" class="icon-btn" data-slide-next aria-label="다음 수상작" title="다음 수상작">${icon('ChevronRight')}</button><div class="award-slide-feedback" role="status"><span></span><button type="button" class="secondary-btn" data-slide-retry hidden>다시 시도</button></div></div><p class="award-slide-caption"></p>`;
    const q = selector => this.host.querySelector(selector);
    const stage = q('.award-slide-stage');
    stage.setAttribute('aria-label', `${title} 수상작 슬라이드`);
    q('[data-slide-prev]').onclick = () => this.move(-1);
    q('[data-slide-next]').onclick = () => this.move(1);
    q('[data-slide-retry]').onclick = () => this.show(this.index);
    q('[data-slide-open]').onclick = () => this.onOpen(this.index, q('[data-slide-open]'));
    stage.ondblclick = event => { if (event.target.tagName === 'IMG') this.onOpen(this.index, stage); };
    this.host.onkeydown = event => this.keydown(event);
    let start = null;
    const pointers = new Set();
    stage.onpointerdown = event => {
      pointers.add(event.pointerId);
      if (pointers.size !== 1 || event.button !== 0 || event.target.closest('button')) { start = null; return; }
      start = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
    };
    stage.onpointerup = event => {
      const previous = start; start = null; pointers.delete(event.pointerId);
      if (!previous || previous.id !== event.pointerId || pointers.size) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.move(dx < 0 ? 1 : -1);
    };
    stage.onpointercancel = event => { pointers.delete(event.pointerId); start = null; };
    void this.show(0);
  }
  keydown(event) {
    if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable) return;
    const next = { ArrowLeft: this.index - 1, ArrowRight: this.index + 1, Home: 0, End: this.items.length - 1 }[event.key];
    if (next === undefined || !this.items.length) return;
    event.preventDefault(); event.stopPropagation();
    if (next >= 0 && next < this.items.length && next !== this.index) void this.show(next);
  }
  move(delta) {
    const next = this.index + delta;
    if (next >= 0 && next < this.items.length) void this.show(next);
  }
  async show(index) {
    if (!this.items[index]) return;
    this.index = index;
    const file = this.items[index], stamp = ++this.revision;
    const q = selector => this.host.querySelector(selector);
    const img = q('img'), feedback = q('.award-slide-feedback'), retry = q('[data-slide-retry]');
    const valid = () => stamp === this.revision && img.isConnected;
    img.hidden = true; img.removeAttribute('src'); img.alt = file.fileName || '수상작';
    q('output').textContent = `${index + 1} / ${this.items.length}`;
    q('.award-slide-caption').textContent = file.fileName || '수상작';
    q('[data-slide-prev]').disabled = index === 0;
    q('[data-slide-next]').disabled = index === this.items.length - 1;
    q('[data-slide-open]').disabled = true;
    feedback.hidden = false; feedback.querySelector('span').textContent = '수상작을 불러오는 중'; retry.hidden = true;
    this.onChange(file.id);
    try {
      const src = await this.cache.get(file.id, { priority: true });
      if (!valid()) return;
      img.src = src;
      await img.decode();
      if (!valid()) return;
      img.hidden = false; feedback.hidden = true; q('[data-slide-open]').disabled = false;
    } catch (error) {
      if (!valid()) return;
      img.removeAttribute('src');
      feedback.querySelector('span').textContent = error.name === 'AbortError' ? '불러오기가 취소되었습니다.' : '수상작을 불러오지 못했습니다.';
      retry.hidden = this.cache.blocked;
    }
  }
}
