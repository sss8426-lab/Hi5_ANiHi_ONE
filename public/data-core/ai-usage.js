export function mountAiUsage({api,element}) {
  element.hidden=false;element.open=true;
  element.innerHTML='<summary>AI 연결 상태 · 월간 사용률</summary><div class="ai-usage-summary" role="status">확인 중…</div><div class="ai-usage-details"></div><div class="ai-usage-budget"></div>';
  const status=element.querySelector('.ai-usage-summary'),details=element.querySelector('.ai-usage-details'),settings=element.querySelector('.ai-usage-budget');
  let busy=false,last=null,epoch=0;
  const when=value=>value?new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(value)):'확인 전';
  function line(text){const p=document.createElement('p');p.textContent=text;details.append(p);}
  function render(value){
    details.replaceChildren();settings.replaceChildren();
    status.textContent=`AI 연결: ${value.connection.state==='confirmed'?'최근 API 응답 확인':value.connection.state==='unconfirmed'?'최근 요청 결과 확인 필요':'실제 호출 확인 전'} · 이번 달 예산 사용률: ${value.percent===null?'—':value.percent.toFixed(1)+'%'}`;
    if(value.percent!==null){const bar=document.createElement('progress');bar.max=100;bar.value=Math.max(0,Math.min(100,value.percent));bar.setAttribute('aria-label',`월간 예산 사용률 ${value.percent.toFixed(1)}%`);details.append(bar);}
    line(`${value.cost===null?'사용량 확인 필요':value.cost.toFixed(4)+' USD'} / ${value.budget?value.budget.amount.toFixed(2)+' USD':'기준 예산 설정 필요'}`);
    line(`${value.scope} · ${value.period} UTC 월 기준 · ${value.source==='official'?'OpenAI 공식 비용':'비용 확인 전'}`);
    line(`최근 정상 집계 ${when(value.updatedAt)} · 제공자 비용 반영 지연 가능`);
    line(`API 응답 확인 ${when(value.connection.checkedAt)}`);
    if(value.state!=='current')line(value.state==='project_required'?'사용량 집계 프로젝트 설정 필요':value.state==='permission_required'?'사용량 조회 권한 확인 필요':'최근 집계 확인 필요 · 마지막 정상값 표시');
    if(value.calls)line(`앱 기록 ${when(value.calls.since)} 이후 · 요청 ${value.calls.attempts}회 · 결과 미확정 ${value.calls.unconfirmed}회 (프로젝트 전체 비용과 별도)`);
    else line('앱 요청 집계 시작 전 · 과거 사용량은 0으로 간주하지 않습니다.');
    if(value.budget)line(value.budget.policy==='hard'?'공식 프로젝트 강제 한도 적용 · 저장된 결과 다운로드 가능':value.budget.policy==='inactive'?'공식 프로젝트 한도 집행 비활성 · 실제 결제 정책은 별도':'앱 내부 관리 예산 · API 차단 한도가 아닙니다.');
    if(value.budget?.stale)line('공식 예산 갱신 실패 · 마지막 확인 예산을 사용합니다.');
    const refresh=document.createElement('button');refresh.type='button';refresh.className='ghost-btn';refresh.textContent='집계 확인';refresh.onclick=load;settings.append(refresh);
    if(value.canSetBudget){
      const form=document.createElement('form');form.className='ai-budget-form';
      form.innerHTML='<label>앱 관리 예산 (USD/월)<input type="number" min="0.01" max="100000000" step="0.01" required aria-label="월간 AI 관리 예산"></label><button class="ghost-btn" type="submit">예산 저장</button><span role="status"></span>';
      const input=form.querySelector('input'),note=form.querySelector('span');
      if(value.budget?.source==='app')input.value=value.budget.amount;
      form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await api('/api/data-core/content/ai-budget',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({amount:Number(input.value)})});await load();}catch(error){note.textContent=error.message;}finally{button.disabled=false;}};
      settings.append(form);
    }
  }
  async function load(){if(busy)return;busy=true;const token=epoch;try{const value=await api('/api/data-core/content/ai-usage');if(token!==epoch)return;last=value;render(last);}catch{if(token!==epoch)return;if(last){render(last);line('갱신 실패 · 마지막 정상값입니다.');}else status.textContent='AI 사용량 확인 필요';}finally{busy=false;}}
  void load();return {refresh:load,clear(){epoch++;last=null;details.replaceChildren();settings.replaceChildren();status.textContent='AI 사용량 확인 필요';}};
}
