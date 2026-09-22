(function () {
  'use strict';
  const labels = {loading:'조회 중',current:'정상',partial:'일부 버킷 집계 누락',setup_required:'설정 필요',permission_denied:'조회 권한 없음',stale:'최근 집계값 표시 중',no_data:'집계 데이터 없음',failed:'조회 실패'};
  const titles = {storage:'CORE 연결 R2 저장량',billing:'Cloudflare 계정 전체 R2 비용'};
  let identity = null, active = false, controller = null, results = {}, attempts = {}, dialog, target;
  const h = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => new Intl.NumberFormat('ko-KR',{maximumFractionDigits:4}).format(value);
  const time = value => value ? new Date(value).toLocaleString('ko-KR') : '미확인';
  function value(kind, result) {
    const data = result?.data;
    if(kind==='storage' && data?.bytes!=null)return number(data.gb)+' GB';
    if(kind==='billing' && data?.cost!=null)return number(data.cost)+' '+data.currency;
    return labels[result?.state] || '조회 중';
  }
  function render() {
    if(!target || !active)return;
    target.innerHTML = Object.keys(titles).map(kind=>`<button class="lb-button lb-usage-badge" type="button" data-usage="${kind}"><small>${titles[kind]}</small><strong>${h(value(kind,results[kind]))}</strong>${results[kind]&&results[kind].state!=='current'&&results[kind].data?`<small>${h(labels[results[kind].state])}</small>`:''}</button>`).join('');
    if(dialog?.open)details(dialog.dataset.kind);
  }
  function details(kind) {
    const result=results[kind] || {state:'loading'}, data=result.data;
    const pairs=[['집계 범위',titles[kind]],['상태',labels[result.state]],['마지막 정상 조회',time(result.updatedAt)],['마지막 조회 시도',time(result.attemptedAt)],['갱신 주기','15분']];
    if(kind==='storage' && data){
      pairs.push(['저장량',data.bytes==null?'전체 합계 미확인':`${number(data.bytes)} bytes / ${number(data.gb)} GB / ${number(data.gib)} GiB`]);
      for(const b of data.buckets)pairs.push([b.bucket,b.bytes==null?'집계 누락':`${number(b.bytes/1e9)} GB · ${time(b.asOf)}${b.delayed?' · 집계 지연':''}`]);
      pairs.push(['용량 기준','객체 본문(payloadSize), 메타데이터 별도']);
    }
    if(kind==='billing'){
      pairs.push(['금액 구분','이번 청구기간 R2 비용 · Cloudflare 집계'],['확정 여부','진행 중 집계 · 최종 청구서 아님'],['청구기간 종료','Cloudflare v1 API 미제공'],['예상 비용','사용량·요금 조건 부족으로 계산하지 않음']);
      for(const p of data?.periods || []){
        pairs.push(['구독 청구기간',`${p.subscriptionId} · ${time(p.periodStart)}부터 · ${number(p.cost)} ${p.currency}`],['사용량 반영',time(p.through)]);
        const services=new Map();for(const item of p.items)services.set(item.service,(services.get(item.service)||0)+item.cost);
        for(const [service,cost] of services)pairs.push([service,`${number(cost)} ${p.currency}`]);
      }
    }
    if(result.missing?.length)pairs.push(['등록할 서버 설정',result.missing.join(', ')],['등록 위치','Cloudflare → Worker → Settings → Variables and Secrets'],['조회 권한','Account Analytics Read 및 별도 Billing 읽기 권한 확인']);
    if(result.reason)pairs.push(['조회 상태',{account_not_supported:'해당 계정의 비용 API 지원 확인 필요',no_r2_rows:'현재 기간의 R2 행 없음',permission_denied:'읽기 권한 확인 필요',rate_limited:'조회 제한, 다음 갱신 때 재시도',subscription_unverified:'구독 범위 확인 필요',unavailable:'외부 집계를 확인하지 못했습니다.'}[result.reason]||'집계 확인 필요']);
    dialog.dataset.kind=kind;
    dialog.innerHTML=`<h3>${titles[kind]}</h3><dl>${pairs.map(([k,v])=>`<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>${result.dashboardUrl?`<a href="${h(result.dashboardUrl)}" target="_blank" rel="noopener">Cloudflare 관리 화면</a>`:''}<div class="lb-toolbar"><button type="button" data-usage-refresh ${Date.now()-(attempts[kind]||0)<900000?'disabled':''}>통계 새로고침</button><button type="button" data-usage-close>닫기</button></div>`;
  }
  async function request(kind, signal, retry=0) {
    const started=Date.now(), user=identity;
    attempts[kind]=started;results[kind] ||= {state:'loading'};render();
    try {
      const response=await fetch('/api/data-core/library/usage/'+kind,{cache:'no-store',signal});
      if(signal.aborted || !active)return;
      if([401,403].includes(response.status)){target.hidden=true;dialog?.close();return;}
      if(!response.ok)throw Error('failed');
      const result=await response.json();if(signal.aborted || !active)return;results[kind]=result;
      if(result.state==='loading'){
        if(retry<6){
          await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,5000);signal.addEventListener('abort',finish,{once:true});});
          if(!signal.aborted&&active)return request(kind,signal,retry+1);
        }else results[kind]={...result,state:'failed'};
      }
    } catch(e){if(signal.aborted)return;results[kind]={...results[kind],state:results[kind]?.data?'stale':'failed'};}
    finally{if(signal.aborted&&identity===user&&attempts[kind]===started)attempts[kind]=0;}
    render();
  }
  function update(context, visible) {
    target=document.getElementById('libraryUsage');if(!target)return;
    const next=context?.authenticated&&context.isSuperAdmin&&!context.mustChangePassword?context.user?.internalUserId:null;
    if(identity!==next){controller?.abort();controller=null;results={};attempts={};identity=next;dialog?.close();}
    active=Boolean(next&&visible);target.hidden=!active;
    if(!active){controller?.abort();controller=null;dialog?.close();target.replaceChildren();return;}
    if(!dialog){dialog=document.createElement('dialog');dialog.id='libraryUsageDialog';dialog.setAttribute('aria-label','R2 사용량 상세');document.getElementById('libraryBrowser').append(dialog);
      target.addEventListener('click',e=>{const kind=e.target.closest('[data-usage]')?.dataset.usage;if(kind){details(kind);dialog.showModal();}});
      dialog.addEventListener('click',e=>{if(e.target===dialog||e.target.closest('[data-usage-close]'))dialog.close();if(e.target.closest('[data-usage-refresh]')&&!e.target.disabled)void request(dialog.dataset.kind,controller.signal);});
    }
    controller ||= new AbortController();render();
    for(const kind of Object.keys(titles))if(Date.now()-(attempts[kind]||0)>=900000)void request(kind,controller.signal);
  }
  window.addEventListener('pagehide',()=>{active=false;controller?.abort();controller=null;dialog?.close();});
  window.DataCoreLibraryUsage={update};
})();
