(() => {
  const entries = [
    ['work-home','업무용 홈','/data-core/work','House'],
    ['library','자료보관함','/data-core/work/library','Folder'],
    ['blog','블로그 자동화','/data-core/content/blog','PenLine'],
    ['instagram','인스타 자동화','/data-core/content/instagram','Image'],
    ['marketing','AI 마케팅 모니터링','/data-core/work/marketing','ClipboardList'],
    ['reports','월간 업무보고','/data-core/reports','ClipboardList'],
    ['kkumeum','꿈이음','/data-core/kkumeum','Users'],
    ['attendance','출석부','/data-core/work/attendance','BookOpen'],
    ['operations','운영관리','/data-core/operations','RotateCcw',true],
    ['accounts','계정·권한 관리','/data-core/accounts','Settings',true],
  ];
  const embedded = Boolean(document.getElementById('nav'));
  for (const mount of document.querySelectorAll('[data-work-navigation]')) {
    const admin = mount.dataset.workNavigation === 'admin';
    for (const [id,label,href,icon,privileged] of entries.filter(item=>Boolean(item[4])===admin)) {
      const local=embedded&&['work-home','library','attendance'].includes(id);
      const node=document.createElement(local?'button':'a');
      node.className='nav-item';node.dataset.workMenu=id;
      if(local){node.type='button';node.dataset.view=id;}else node.href=href;
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
  let signupChecked=false;
  // MASTER sees how many 직원인증 requests wait for approval next to 캠퍼스 계정 관리.
  async function showSignupCount(){
    if(signupChecked||typeof fetch!=='function')return;signupChecked=true;
    try{
      const response=await fetch('/api/auth/signup-requests',{credentials:'include',cache:'no-store'});
      if(!response.ok)return;
      const count=((await response.json()).requests||[]).length;
      document.querySelectorAll('[data-work-menu="accounts"]').forEach(node=>{
        node.querySelector('.nav-badge')?.remove();
        if(!count)return;
        const badge=document.createElement('span');badge.className='nav-badge';badge.textContent=String(count);
        badge.title=`직원인증 신청 ${count}건`;badge.setAttribute('aria-label',badge.title);node.append(badge);
      });
    }catch{/* the badge is optional */}
  }
  // 꿈이음은 마스터·캠퍼스 관리자·원장·선생님만 쓴다(직원 계정은 서버에서 막히므로 메뉴도 숨긴다).
  const KKUMEUM_ROLES=['MASTER','SUPER_ADMIN','CAMPUS_ADMIN','CAMPUS_DIRECTOR','TEACHER'];
  function setContext(context){
    document.querySelectorAll('[data-work-navigation="admin"]').forEach(node=>node.classList.toggle('hidden',!context?.authenticated||!context.isSuperAdmin));
    const kkumeum=Boolean(context?.authenticated&&(context.isSuperAdmin||(context.memberships||[]).some(m=>KKUMEUM_ROLES.includes(m.role))));
    document.documentElement?.classList?.toggle('core-no-kkumeum',Boolean(context?.authenticated)&&!kkumeum);
    if(document.head&&document.getElementById&&!document.getElementById('core-no-kkumeum-style')){const style=document.createElement('style');style.id='core-no-kkumeum-style';style.textContent='html.core-no-kkumeum [data-kkumeum-nav],html.core-no-kkumeum [data-kkumeum-card],html.core-no-kkumeum [data-work-menu="kkumeum"],html.core-no-kkumeum [data-ma-go="kkumeum"]{display:none!important}';document.head.append(style);}
    if(context?.authenticated&&context.isSuperAdmin)void showSignupCount();
  }
  select(entries.find(item=>item[2]===location.pathname)?.[0]);
  window.DataCoreWorkNavigation={select,setContext,signupCount:showSignupCount};
})();
