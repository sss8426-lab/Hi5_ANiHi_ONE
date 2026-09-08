import { careerMajorKeywords } from '/data-core/admissions-model.js?v=20260909-1';
import { occupationImageConcepts } from '/data-core/occupation-image-concepts.js?v=20260909-1';

const h = (v) => String(v ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {susi:'미대 수시 입시요강',jungsi:'미대 정시 입시요강'};
const state = {susi:{},jungsi:{}};
let requestId=0, controller;
const date = (v) => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('ko-KR') : '확인 필요';
async function api(path,body,signal) {
  const response = await fetch(path,{method:body?'POST':'GET',credentials:'include',cache:'no-store',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal});
  if(!response.headers.get('content-type')?.includes('application/json')) throw new Error(`요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요. (HTTP ${response.status})`);
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || '자료를 불러오지 못했습니다.');
  return data;
}
const endpoint='/api/data-core/admissions/guidelines';
const syncEndpoint='/api/data-core/admin/admissions/guidelines/sync';
const fieldNames = {academicYear:'학년도',universityName:'대학',campus:'캠퍼스',region:'지역',department:'학과·모집단위',admissionType:'전형명',admissionCategory:'전형유형',admissionGroup:'모집군',quota:'모집인원',gradeRatio:'학생부 반영비율 (%)',practicalRatio:'실기 반영비율 (%)',csatRatio:'수능 반영비율 (%)',documentRatio:'서류 반영비율 (%)',interviewRatio:'면접 반영비율 (%)',selectionFormula:'전형요소 반영방법',practicalType:'실기과목·유형',eligibility:'지원자격',csatMinimum:'수능최저',competitionRate:'전년도 경쟁률',applicationPeriod:'원서접수기간',practicalExamDate:'실기·면접 시험일',resultDate:'합격자 발표',csatSubjects:'수능 응시영역',csatMetric:'수능 활용지표',koreanRatio:'국어 비율',koreanSubject:'국어 선택과목',englishMethod:'영어 반영',mathRatio:'수학 비율',mathSubject:'수학 선택과목',historyMethod:'한국사 반영',inquiryRatio:'탐구 비율',inquirySubject:'탐구 선택과목',inquiryCount:'탐구 과목 수',bonus:'선택과목·가산'};
function detail(row) {
  document.querySelector('.guideline-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.className='guideline-dialog';
  dialog.innerHTML=`<header><div><p class="guideline-note">${h(row.academicYear)}학년도 · ${h(names[row.admissionSeason])}</p><h2>${h(row.universityName)}</h2><p>${h(row.department)} · ${h(row.admissionType)}</p></div><button class="close" aria-label="상세 닫기">×</button></header><dl>${Object.entries(fieldNames).filter(([k])=>!['susi'].includes(row.admissionSeason)||!['admissionGroup','csatSubjects','csatMetric','koreanRatio','koreanSubject','englishMethod','mathRatio','mathSubject','historyMethod','inquiryRatio','inquirySubject','inquiryCount','bonus'].includes(k)).map(([key,label])=>`<dt>${label}</dt><dd>${h(row[key] ?? '공개 자료에서 확인 필요')}</dd>`).join('')}</dl><p class="guideline-note">출처: ${h(row.sourceName)}<br>원본 파일 갱신: ${h(date(row.sourceUpdatedAt))}<br>우리 데이터 동기화: ${h(date(row.fetchedAt))}<br>실제 지원 전 반드시 해당 대학의 공식 모집요강을 확인하세요.</p>`;
  if(row.sourceUrl && /^https:\/\/grinalda\.net\/univ-info-(susi|jungsi)\/$/.test(row.sourceUrl)){const a=document.createElement('a');a.href=row.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='공개 원문 보기 ↗';dialog.append(a);}
  if(row.universityId){const a=document.createElement('a');a.href=`/#page=admin&university=${encodeURIComponent(row.universityId)}`;a.target='_top';a.textContent=' · 연결된 대학 데이터 보기';dialog.append(a);}
  document.body.append(dialog);dialog.querySelector('.close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}

export async function renderGuidelines(season) {
  const root=document.getElementById(season); if(!root || root.classList.contains('hidden')) return;
  const filters=state[season];
  let deepLink;
  try { deepLink=new URLSearchParams(window.top.location.hash.slice(1)).get('guideline'); } catch { deepLink=new URLSearchParams(location.hash.slice(1)).get('guideline'); }
  if(deepLink)filters.id=deepLink;
  root.innerHTML=`<div class="top"><div><h1>${names[season]}</h1><p>${season==='susi'?'전국 미술·디자인계열 수시 전형':'전국 미술·디자인계열 정시 전형과 수능·실기 반영방법'}</p></div><div class="actions"><button class="btn" data-other>${names[season==='susi'?'jungsi':'susi']} →</button><button class="btn" data-sync hidden>↻ 입시요강 데이터 새로고침</button></div></div><form class="guideline-toolbar"><label class="query">대학·학과·지역·전형 검색<input name="query" type="search" value="${h(filters.query || '')}" placeholder="대학명, 학과, 전형명"></label><label>학년도<select name="year"><option value="">전체</option></select></label><label>지역<select name="region"><option value="">전체</option></select></label><button class="btn primary" type="submit">검색</button><button class="btn" type="reset">초기화</button></form><details><summary>상세 조건</summary><div class="guideline-filters">${[['university','대학'],['major','연결 직업·전공'],['category','전형유형'],['practical','실기유형'],...(season==='jungsi'?[['group','모집군'],['csatSubjects','수능 응시영역']]:[['minimum','수능최저']]),['gradeRatio','학생부 비율'],['practicalRatio','실기 비율'],...(season==='jungsi'?[['csatRatio','수능 비율']]:[]),['sort','정렬']].map(([name,label])=>`<label>${label}<select name="${name}"><option value="">전체</option></select></label>`).join('')}</div></details><div class="guideline-status" role="status" data-status>저장된 입시요강을 불러오고 있습니다.</div><div data-results></div><p class="guideline-note">출처: 그리날다 공개 입시정보 · 회원 전용 상세정보는 수집하지 않습니다.<br>반영비율을 단일 수치로 확인할 수 없는 단계별 전형은 상세 반영방법을 확인하세요.<br>실제 지원 전 반드시 해당 대학의 공식 모집요강을 확인하세요.</p>`;
  root.querySelector('[data-other]').onclick=()=>document.querySelector(`#nav button[data-page="${season==='susi'?'jungsi':'susi'}"]`).click();
  const status=root.querySelector('[data-status]');
  const form=root.querySelector('form');
  let currentRows=[];
  const readFilters=()=>{root.querySelectorAll('input[name],select[name]').forEach((el)=>filters[el.name]=el.value);filters.page=1;};
  function options(name,values,labels) {
    const el=root.querySelector(`select[name="${name}"]`);if(!el)return;
    el.innerHTML='<option value="">전체</option>'+values.map((v)=>`<option value="${h(v)}">${h(labels?.[v] || v)}</option>`).join('');el.value=filters[name] || '';
  }
  options('major',Object.keys(careerMajorKeywords),Object.fromEntries(occupationImageConcepts.map((c)=>[c.occupationId,c.title])));
  for(const key of ['gradeRatio','practicalRatio','csatRatio'])options(key,['0','30','50','70','100'],{'0':'0% 이상','30':'30% 이상','50':'50% 이상','70':'70% 이상','100':'100%'});
  options('minimum',['yes','none'],{yes:'있음',none:'없음'});options('sort',['university','region','practical','grade','competition'],{university:'대학명',region:'지역',practical:'실기 반영비율 높은 순',grade:'학생부 반영비율 높은 순',competition:'전년도 경쟁률 높은 순'});
  async function load() {
    const id=++requestId;controller?.abort();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
    status.hidden=false;status.textContent='저장된 입시요강을 확인하고 있습니다.';
    try {
      const params=new URLSearchParams({...filters,season});const data=await api(`${endpoint}?${params}`,null,controller.signal);
      if(id!==requestId || root.classList.contains('hidden'))return;
      currentRows=data.rows;for(const [key,values]of Object.entries(data.facets))options(key,values);
      if(deepLink && currentRows.some(r=>r.id===deepLink)){detail(currentRows.find(r=>r.id===deepLink));deepLink=null;delete filters.id;}
      root.querySelector('[data-sync]').hidden=!data.canSync;status.textContent=`검색 결과 ${data.total}개`;
      root.querySelector('[data-results]').innerHTML=data.rows.length?`<div class="guideline-table"><table><thead><tr><th>학년도</th><th>대학·학과</th><th>전형</th><th>지역</th><th>모집인원</th><th>실기</th><th>학생부</th><th>전년도 경쟁률</th></tr></thead><tbody>${data.rows.map((r,i)=>`<tr><td>${h(r.academicYear)}</td><td><button data-detail="${i}">${h(r.universityName)}<br>${h(r.department)}</button></td><td>${h(r.admissionType)}${r.admissionGroup?` · ${h(r.admissionGroup)}군`:''}</td><td>${h(r.region || '확인 필요')}</td><td>${h(r.quota ?? '확인 필요')}</td><td>${r.practicalRatio===null?'상세 확인':`${h(r.practicalRatio)}%`}</td><td>${r.gradeRatio===null?'상세 확인':`${h(r.gradeRatio)}%`}</td><td>${h(r.competitionRate ?? '확인 필요')}</td></tr>`).join('')}</tbody></table></div><div class="guideline-pager"><button class="btn" data-prev ${data.page<=1?'disabled':''}>← 이전</button><span>${data.page} / ${Math.max(1,Math.ceil(data.total/40))}</span><button class="btn" data-next ${data.page*40>=data.total?'disabled':''}>다음 →</button></div>`:'<p class="guideline-empty">조건에 맞는 저장된 입시요강이 없습니다.</p>';
      root.querySelectorAll('[data-detail]').forEach((b)=>b.onclick=()=>detail(currentRows[Number(b.dataset.detail)]));
      const prev=root.querySelector('[data-prev]'),next=root.querySelector('[data-next]');if(prev)prev.onclick=()=>{filters.page=data.page-1;load();};if(next)next.onclick=()=>{filters.page=data.page+1;load();};
    }catch(error){if(id===requestId){status.textContent=error.name==='AbortError'?'조회 시간이 길어졌습니다. 다시 검색해주세요.':error.message;root.querySelector('[data-results]').replaceChildren();}}
    finally{clearTimeout(timeout);}
  }
  form.onsubmit=(e)=>{e.preventDefault();readFilters();load();};form.onreset=(e)=>{e.preventDefault();state[season]={};renderGuidelines(season);};
  root.querySelectorAll('select').forEach((el)=>el.onchange=()=>{readFilters();load();});
  root.querySelector('[data-sync]').onclick=async()=>{
    const button=root.querySelector('[data-sync]');button.disabled=true;status.hidden=false;status.textContent='공개 원본을 확인하고 변경사항을 비교합니다. 기존 대학 데이터는 수정하지 않습니다.';
    try {
      const preview=await api(syncEndpoint,{mode:'preview'});
      const summary=Object.entries(preview.counts).map(([key,c])=>`${names[key]}: 신규 ${c.new}, 변경 ${c.changed}, 동일 ${c.unchanged}, 보류 ${c.review}, 대학 연결 검토 ${c.mappingReview}`).join('\n');
      const dialog=document.createElement('dialog');dialog.className='guideline-dialog';dialog.innerHTML=`<h2>입시요강 동기화 미리보기</h2><p style="white-space:pre-wrap;line-height:2">${h(summary)}</p><p class="guideline-note">보류 자료와 기존 대학 원본은 변경하지 않습니다. 대학 연결 검토 항목은 자동 병합하지 않고 출처별 요강으로만 보관합니다.</p><div class="actions"><button class="btn" data-cancel>취소</button><button class="btn primary" data-apply>확인한 요강 적용</button></div>`;document.body.append(dialog);dialog.showModal();
      const approved=await new Promise((resolve)=>{dialog.querySelector('[data-apply]').onclick=()=>{resolve(true);dialog.close();};dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{resolve(false);dialog.remove();},{once:true});});
      if(!approved){status.textContent='동기화를 취소했습니다. 기존 데이터를 변경하지 않았습니다.';return;}
      let offset=0,applied=0;
      while(offset<preview.total){status.textContent=`입시요강 적용 중 ${offset} / ${preview.total}`;const result=await api(syncEndpoint,{mode:'apply',token:preview.token,offset});applied+=result.applied;if(result.nextOffset<=offset)throw new Error('동기화 진행상태를 확인할 수 없습니다.');offset=result.nextOffset;}
      await load();status.textContent=`입시요강 ${applied}건 적용 완료. 기존 대학·학생·합격사례 원본은 보존했습니다.`;
    }catch(error){status.textContent=`${error.message} 이미 저장된 요강은 유지됩니다. 다시 미리보기에서 남은 변경사항을 확인하세요.`;}
    finally{button.disabled=false;}
  };
  await load();
}
