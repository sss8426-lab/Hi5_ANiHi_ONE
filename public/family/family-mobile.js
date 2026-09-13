(() => {
  const family=document.getElementById('familyView');
  if(!family)return;
  const shell=document.querySelector('.family-shell');
  const icon=name=>`<svg class="km-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"/></svg>`;
  const names=['아이소식','반소식','전체공지','선택전달'];
  const keys=['kids-news','class-news','notices','select-delivery'];
  const filters=[['child-message'],['class-news'],['campus-news','organization-notice'],['selected-delivery']];
  const top=document.createElement('nav');top.className='km-tabs';top.setAttribute('aria-label','꿈이음 소식');top.setAttribute('role','tablist');top.hidden=true;
  top.innerHTML=names.map((label,i)=>`<button type="button" role="tab" data-family-news="${i}" aria-selected="${i===0}">${label}</button>`).join('');
  document.querySelector('.app-header').after(top);
  const bottom=document.createElement('nav');bottom.className='km-bottom';bottom.hidden=true;bottom.setAttribute('aria-label','꿈이음 하단 메뉴');
  const menus=[['attendance','ShieldCheck','출석체크'],['news','BookOpen','아이소식 글모음'],['answers','BookOpen','답변모음'],['inquiries','PenLine','문의모음'],['more','Menu','더보기']];
  bottom.innerHTML=menus.map(([key,img,label])=>`<button type="button" data-family-menu="${key}">${icon(img)}<span>${label}</span></button>`).join('');shell.append(bottom);
  const more=document.createElement('dialog');more.className='km-more';more.setAttribute('aria-label','더보기');
  more.innerHTML='<div class="km-sheet-head"><h2>더보기</h2><button type="button" data-close>닫기</button></div><div class="km-more-items">'+[['home','House','아이 성장'],['child','Image','작품'],['growth','BookOpen','월간 평가'],['more','Settings','알림 · 계정'],['help','BookOpen','도움말'],['suggest','PenLine','비트에게 건의/문의'],['consents','ShieldCheck','신청/동의서']].map(([key,img,label])=>`<button type="button" data-open="${key}">${icon(img)}<span>${label}</span></button>`).join('')+'</div>';shell.append(more);
  const extra=document.createElement('section');extra.hidden=true;extra.className='km-detail';family.append(extra);
  const tools=document.createElement('div');tools.id='familyMobileTools';tools.className='km-actions';tools.innerHTML='<button type="button" data-family-records>작품 · 월간 평가</button>';family.prepend(tools);
  function existing(tab){extra.hidden=true;document.querySelector(`#bottomNav [data-tab="${tab}"]`)?.click();}
  function news(index,update=true){
    if(family.classList.contains('hidden'))return;
    existing('news');window.dispatchEvent(new CustomEvent('family:news-filter',{detail:filters[index]}));
    top.querySelectorAll('button').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;});
    if(update){const u=new URL(location.href);u.searchParams.set('tab',keys[index]);history.pushState(null,'',u);}
  }
  function unavailable(key){
    document.querySelectorAll('#familyView [data-panel]').forEach(p=>p.classList.remove('active'));extra.hidden=false;
    const label=({attendance:'출석체크',answers:'답변모음',inquiries:'문의모음',help:'도움말',suggest:'비트에게 건의/문의',consents:'신청/동의서'})[key]||'소식';
    extra.replaceChildren();const h=document.createElement('h2');h.textContent=label;const p=document.createElement('p');p.className='km-state';p.textContent=key==='help'?'작품 · 월간 평가에서 연결된 자녀의 성장기록을 확인할 수 있습니다. 계정 관련 문의는 학원에 연락해주세요.':`${label}은 아직 연결된 운영 기능이 없습니다.`;extra.append(h,p);
  }
  top.addEventListener('click',e=>{const b=e.target.closest('[data-family-news]');if(b)news(Number(b.dataset.familyNews));});
  top.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const i=Number(document.activeElement.dataset.familyNews||0);const n=(i+(e.key==='ArrowRight'?1:3))%4;news(n);top.querySelectorAll('button')[n].focus();});
  bottom.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;bottom.querySelectorAll('button').forEach(n=>n.removeAttribute('aria-current'));b.setAttribute('aria-current','page');const key=b.dataset.familyMenu;if(key==='more')more.showModal();else if(key==='news')news(0);else unavailable(key);});
  more.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;more.close();if(b.hasAttribute('data-close'))return;const key=b.dataset.open;if(['home','child','growth','more'].includes(key))existing(key);else unavailable(key);});
  tools.querySelector('button').onclick=()=>existing('home');
  let visible=false;
  function sync(){const ready=!family.classList.contains('hidden');top.hidden=!ready;bottom.hidden=!ready;if(ready&&!visible){visible=true;const index=keys.indexOf(new URLSearchParams(location.search).get('tab'));news(Math.max(0,index),false);}if(!ready){visible=false;more.close();extra.replaceChildren();}}
  new MutationObserver(sync).observe(family,{attributes:true,attributeFilter:['class']});
  window.addEventListener('popstate',()=>{const i=keys.indexOf(new URLSearchParams(location.search).get('tab'));news(Math.max(0,i),false);});
  sync();
})();
