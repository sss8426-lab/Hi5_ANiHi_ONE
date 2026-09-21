(() => {
  const entries = [
    ['work-home','업무용 홈','/data-core/work','House'],
    ['library','자료보관함','/data-core/work/library','Folder'],
    ['blog','블로그 자동화','/data-core/content/blog','PenLine'],
    ['instagram','인스타 자동화','/data-core/content/instagram','Image'],
    ['kkumeum','꿈이음','/data-core/kkumeum','Users'],
    ['attendance','출석부','/data-core/work/attendance','BookOpen'],
    ['mode-home','모드 선택으로 돌아가기','/data-core','ArrowLeft'],
    ['operations','운영관리','/data-core/operations','RotateCcw',true],
    ['accounts','캠퍼스 계정 관리','/data-core/accounts','Settings',true],
    ['readiness','readiness','/data-core/readiness','Check',true],
    ['admin','권한관리','/data-core/work?view=admin','Settings',true],
  ];
  const embedded = Boolean(document.getElementById('nav'));
  for (const mount of document.querySelectorAll('[data-work-navigation]')) {
    const admin = mount.dataset.workNavigation === 'admin';
    for (const [id,label,href,icon,privileged] of entries.filter(item=>Boolean(item[4])===admin)) {
      const local=embedded&&['work-home','library','attendance','mode-home','admin'].includes(id);
      const node=document.createElement(local?'button':'a');
      node.className='nav-item';node.dataset.workMenu=id;
      if(local){node.type='button';node.dataset.view=id;}else node.href=href;
      if(id==='admin'&&embedded)node.id='adminNav';
      if(id==='kkumeum')node.dataset.kkumeumNav='true';
      if(id==='blog'||id==='instagram')node.dataset.contentNav=id;
      node.innerHTML=`<svg class="nav-icon core-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${icon}"></use></svg><span>${label}</span>`;
      mount.append(node);
    }
  }
  function select(id){
    document.querySelectorAll('[data-work-menu]').forEach(node=>{
      const active=node.dataset.workMenu===id;node.classList.toggle('active',active);
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
    });
  }
  function setContext(context){
    document.querySelectorAll('[data-work-navigation="admin"]').forEach(node=>node.classList.toggle('hidden',!context?.authenticated||!context.isSuperAdmin));
  }
  select(entries.find(item=>item[2]===location.pathname)?.[0]);
  window.DataCoreWorkNavigation={select,setContext};
})();
