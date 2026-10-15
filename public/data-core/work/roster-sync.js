// 출석부 → 꿈이음 반영 표. 출석부 화면(만든 직후)과 꿈이음 아이소식(위쪽 알림 줄)에서 같이 쓴다.
// 출석부와 꿈이음 반·학생이 다른 곳을 학생마다 체크박스로 보여 주고, 체크한 줄만 적용한다.
// "적용 안 함"을 고른 줄은 그 달에는 다시 묻지 않고, 아래 접힌 목록에서 다시 볼 수 있다. 서버가 권한(원장·관리자)을 다시 확인한다.
(() => {
  if (window.RosterSync) return;
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const SECTIONS = [
    ['new', '새 학생', '꿈이음에 없는 학생입니다. 체크하면 출석부의 반으로 등록합니다.'],
    ['move', '반 이동', '꿈이음의 반이 출석부와 다릅니다. 체크하면 출석부의 반으로 옮깁니다.'],
    ['reactivate', '재원으로 되돌리기', '꿈이음에서 휴원·퇴원인 학생이 출석부에 있습니다. 체크하면 재원으로 바꿉니다.'],
    ['leave', '출석부에 없는 재원생', '이번 달 출석부에 없습니다. 체크하면 휴원으로 바뀌어 출석체크·출결기에서 빠집니다. (기본은 체크하지 않음)'],
    ['hide', '출석부에 없는 반', '체크하면 꿈이음 반 목록에서 숨깁니다. 재원생이 남아 있는 반은 숨기지 않습니다.'],
  ];
  const STATUS = { leave: '휴원', withdrawn: '퇴원', moved: '이동', graduated: '졸업' };
  const css = `.rs{display:grid;gap:12px;border:1px solid #cfe0db;border-radius:14px;background:#fff;padding:14px;margin:10px 0;color:#1f2a24}
.rs h3{margin:0;font-size:17px}.rs p{margin:0}.rs-meta{font-size:13.5px;color:#5b6c66;line-height:1.6}
.rs-ok{background:#eef7f2;color:#16614f;border-radius:10px;padding:10px 12px;font-weight:700}
.rs-sec{border:1px solid #e1e8e5;border-radius:12px;padding:10px 12px;display:grid;gap:6px}
.rs-sec-head{display:flex;align-items:center;gap:8px;font-weight:800;font-size:15px}.rs-sec-head small{font-weight:600;color:#5b6c66}
.rs-row{display:flex;align-items:center;gap:10px;min-height:44px;border-top:1px dashed #e6ece9;padding-top:4px;cursor:pointer;flex-wrap:wrap}
.rs-row:first-of-type{border-top:0}.rs input[type=checkbox]{width:22px;height:22px;accent-color:#167d79;flex:none;margin:0}
.rs-name{font-weight:800}.rs-change{font-size:14px;color:#475a55}.rs-change b{color:#167d79}.rs-warn{color:#a3271d;font-size:12.5px}
.rs-actions{display:flex;flex-wrap:wrap;gap:8px}
.rs-actions button{min-height:44px;border-radius:10px;padding:0 16px;font:inherit;font-weight:800;cursor:pointer;border:1px solid #cfdcd8;background:#fff;color:#1f2a24}
.rs-actions .rs-primary{background:#167d79;border-color:#167d79;color:#fff}.rs-actions button:disabled{opacity:.45;cursor:default}
.rs-status{font-size:14px;color:#16614f;background:#eef7f2;border-radius:10px;padding:8px 12px}.rs-status.rs-err{color:#a3271d;background:#fdecea}
.rs details summary{cursor:pointer;font-weight:700;color:#475a55;min-height:40px;display:flex;align-items:center}
.rs-skip{display:flex;align-items:center;gap:8px;font-size:14px;padding:4px 0}.rs-skip button{border:0;background:none;color:#167d79;font-weight:800;cursor:pointer;min-height:36px}
.rs-amb li{font-size:14px;margin:4px 0}.rs a{color:#167d79;font-weight:800}`;
  function style() { if (document.getElementById('rosterSyncStyle')) return; const el = document.createElement('style'); el.id = 'rosterSyncStyle'; el.textContent = css; document.head.append(el); }
  async function api(path, options = {}) {
    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || '처리하지 못했습니다. 다시 시도해 주세요.'), { status: res.status });
    return body;
  }

  function mount(box, { campusId, month = '', onChange } = {}) {
    style();
    const st = { data: null, checked: new Set(), busy: false, message: '', error: false };
    const q = () => `campusId=${encodeURIComponent(campusId)}${st.data?.month || month ? `&month=${encodeURIComponent(st.data?.month || month)}` : ''}`;
    function change(it) {
      if (it.type === 'new') return `<b>${h(it.toClass)}</b>에 새로 등록${it.rows > 1 ? ` (출석부 ${it.rows}줄)` : ''}`;
      if (it.type === 'move') return `${h(it.fromClass)} → <b>${h(it.toClass)}</b>`;
      if (it.type === 'reactivate') return `${h(STATUS[it.status] || it.status)} → <b>재원</b> · ${h(it.toClass)}`;
      if (it.type === 'leave') return `${h(it.fromClass)} · 재원 → <b>휴원</b>`;
      return `목록에서 숨기기${it.activeCount ? ` <span class="rs-warn">지금 재원생 ${it.activeCount}명 · 위 반 이동·휴원 후에도 학생이 남으면 숨기지 않음</span>` : ''}`;
    }
    function paint() {
      const d = st.data;
      if (!d) { box.innerHTML = '<div class="rs"><p class="rs-meta">출석부와 꿈이음 명단을 비교하는 중...</p></div>'; return; }
      if (!d.month) { box.innerHTML = '<div class="rs"><p class="rs-meta">아직 저장된 출석부가 없습니다. 업무 › 출석부에서 먼저 만들어 주세요.</p></div>'; return; }
      const open = d.items.filter(i => !i.skipped), skipped = d.items.filter(i => i.skipped);
      const label = `${Number(d.month.slice(5))}월`;
      const sections = SECTIONS.map(([type, title, note]) => {
        const rows = open.filter(i => i.type === type);
        if (!rows.length) return '';
        const all = rows.every(i => st.checked.has(i.key));
        return `<section class="rs-sec"><label class="rs-sec-head"><input type="checkbox" data-rs-all="${type}" ${all ? 'checked' : ''} aria-label="${h(title)} 전체 선택"> ${h(title)} <small>${rows.length}명</small></label>
          <p class="rs-meta">${h(note)}</p>${rows.map(i => `<label class="rs-row"><input type="checkbox" data-rs-key="${h(i.key)}" ${st.checked.has(i.key) ? 'checked' : ''}><span class="rs-name">${h(i.name)}</span><span class="rs-change">${change(i)}</span></label>`).join('')}</section>`;
      }).join('');
      const amb = d.ambiguous.length ? `<section class="rs-sec rs-amb"><div class="rs-sec-head">확인 필요 <small>${d.ambiguous.length}명</small></div>
        <p class="rs-meta">같은 이름의 학생이 여러 명이라 누구인지 정해야 합니다. <a href="/data-core/kkumeum?tab=kids-news&view=attendance-settings">출결 설정 › 명단 정리</a>에서 연결해 주세요.</p>
        <ul>${d.ambiguous.map(a => `<li>${h(a.className)} · <b>${h(a.name)}</b> — 후보: ${a.candidates.map(c => `${h(c.name)}(${h(c.className || '반 없음')}${c.status !== 'active' ? `·${h(STATUS[c.status] || c.status)}` : ''})`).join(', ') || '없음'}</li>`).join('')}</ul></section>` : '';
      const n = open.filter(i => st.checked.has(i.key)).length;
      const skipList = skipped.length ? `<details><summary>적용하지 않기로 한 줄 ${skipped.length}개</summary>${skipped.map(i => `<div class="rs-skip"><span class="rs-name">${h(i.name)}</span><span class="rs-change">${change(i)}</span><button type="button" data-rs-unskip="${h(i.key)}">다시 보기</button></div>`).join('')}</details>` : '';
      // 적용 버튼은 표 위와 아래에 둔다 (휴대폰 하단 메뉴에 가려지지 않게).
      const actions = open.length ? `<div class="rs-actions"><button type="button" class="rs-primary" data-rs-apply ${n && !st.busy ? '' : 'disabled'}>선택한 ${n}건 적용</button><button type="button" data-rs-skip ${n && !st.busy ? '' : 'disabled'}>선택한 ${n}건 적용 안 함</button></div>` : '';
      const status = st.message ? `<p class="rs-status${st.error ? ' rs-err' : ''}" role="status">${h(st.message)}</p>` : '';
      if (!open.length && !d.ambiguous.length) {
        box.innerHTML = `<div class="rs"><h3>출석부 → 꿈이음 반영 (${label})</h3>${status}<p class="rs-ok">✓ 출석부와 꿈이음 반·학생 명단이 같습니다.</p>${skipList}</div>`;
        return;
      }
      box.innerHTML = `<div class="rs"><h3>출석부 → 꿈이음 반영 (${label})</h3>
        <p class="rs-meta">출석부와 꿈이음 반·학생이 다른 곳입니다. 적용할 학생을 체크하고 <b>적용</b>을 누르세요. 체크하지 않은 줄은 그대로 둡니다.</p>
        ${status}${actions}${sections}${amb}${actions}${skipList}</div>`;
    }
    function reset(data) {
      st.data = data;
      st.checked = new Set(data.items.filter(i => !i.skipped && i.checked).map(i => i.key));
    }
    async function load() {
      st.data = null; paint();
      try { reset(await api(`/api/kkumeum/attendance/roster-sync?${q()}`)); }
      catch (e) { box.innerHTML = `<div class="rs"><p class="rs-status rs-err">${h(e.status === 403 ? '출석부 반영은 캠퍼스 원장·관리자만 할 수 있습니다.' : e.message)}</p></div>`; return; }
      paint();
    }
    async function send(body, done) {
      if (st.busy) return; st.busy = true; paint();
      try {
        const data = await api('/api/kkumeum/attendance/roster-sync', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ campusId, month: st.data.month, updatedAt: st.data.updatedAt, ...body }) });
        reset(data); st.message = done(data.result || {}); st.error = false;
        if (typeof onChange === 'function') onChange(data);
      } catch (e) { st.message = e.message; st.error = true; if (e.status === 409) { st.busy = false; await load(); st.message = e.message; st.error = true; } }
      finally { st.busy = false; paint(); }
    }
    box.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.rsKey) { if (el.checked) st.checked.add(el.dataset.rsKey); else st.checked.delete(el.dataset.rsKey); paint(); }
      else if (el.dataset.rsAll) { st.data.items.filter(i => !i.skipped && i.type === el.dataset.rsAll).forEach(i => el.checked ? st.checked.add(i.key) : st.checked.delete(i.key)); paint(); }
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      const keys = st.data.items.filter(i => !i.skipped && st.checked.has(i.key)).map(i => i.key);
      if (b.hasAttribute('data-rs-apply')) {
        const leave = st.data.items.filter(i => i.type === 'leave' && keys.includes(i.key)).length;
        if (leave && !confirm(`${leave}명을 휴원으로 바꿉니다. 출석체크와 출결기에서 빠집니다. 적용할까요?`)) return;
        void send({ apply: keys }, r => {
          const a = r.applied || {}, parts = [a.new && `새 학생 ${a.new}명`, a.move && `반 이동 ${a.move}명`, a.reactivate && `재원 ${a.reactivate}명`, a.leave && `휴원 ${a.leave}명`, a.hide && `반 숨김 ${a.hide}개`].filter(Boolean);
          return `${parts.join(' · ') || '바뀐 것 없음'} 적용했습니다.${r.notHidden?.length ? ` (${r.notHidden.join(', ')} 반은 재원생이 있어 숨기지 않았어요)` : ''}`;
        });
      } else if (b.hasAttribute('data-rs-skip')) {
        void send({ skip: keys }, () => `${keys.length}건은 적용하지 않기로 했습니다. 아래 "적용하지 않기로 한 줄"에서 다시 볼 수 있어요.`);
      } else if (b.dataset.rsUnskip) {
        void send({ unskip: [b.dataset.rsUnskip] }, () => '다시 목록에 올렸습니다.');
      }
    });
    void load();
    return { reload: load };
  }
  window.RosterSync = { mount };
})();
