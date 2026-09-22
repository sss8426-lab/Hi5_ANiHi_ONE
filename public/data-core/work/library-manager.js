import { setupUploads } from './library-upload-panel.js';
import { open as openPreview } from './library-preview.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const cardSelector='[data-library-file],[data-recent-file],[data-library-folder]';
export function setup(ctx){
  const css=el('link');css.rel='stylesheet';css.href='/data-core/work/library-manager.css';document.head.append(css);
  const {host,state,api,navigate,load,locationState}=ctx,selected=new Map();let anchor=null,drag=null,selectionOrigin='',moveItems=[],requestId;
  const key=card=>card.dataset.libraryFolder?'folder:'+card.dataset.libraryFolder:'file:'+(card.dataset.libraryFile||card.dataset.recentFile);
  const lookup=k=>{const [kind,...id]=k.split(':');const item=(kind==='folder'?state.folders:[...state.files,...state.recent]).find(i=>i.id===id.join(':'));return item?{...item,kind}:null;};
  const controls=el('div');controls.className='lb-manage lb-toolbar';
  controls.innerHTML='<label>정렬 <select aria-label="파일 정렬"><option value="newest">최신순</option><option value="oldest">오래된순</option><option value="name">이름 오름차순</option><option value="name-desc">이름 내림차순</option><option value="size">큰 파일순</option><option value="size-asc">작은 파일순</option></select></label><div role="group" aria-label="보기 방식"><button data-view="grid" aria-label="그리드 보기" title="그리드 보기">▦</button><button data-view="list" aria-label="목록 보기" title="목록 보기">☰</button></div><button data-select-all>불러온 항목 선택</button><button data-clear>선택 해제</button><button data-move>선택 항목 이동</button><span role="status" data-count></span>';
  host.querySelector('#librarySearch').after(controls);
  const trash=el('button','선택 항목 휴지통');trash.dataset.trash='';controls.querySelector('[data-count]').before(trash);
  for(const b of controls.querySelectorAll('[data-view]'))b.innerHTML=`<svg class="lb-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${b.dataset.view==='grid'?'LayoutDashboard':'Menu'}"></use></svg>`;
  let mode='grid';try{mode=localStorage.getItem('library-view')||mode;}catch{/* Storage may be disabled. */}
  const setMode=value=>{mode=value==='list'?'list':'grid';host.dataset.view=mode;for(const b of controls.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===mode));try{localStorage.setItem('library-view',mode);}catch{/* View preference is optional. */}};setMode(mode);
  controls.querySelector('select').onchange=e=>{const s=locationState();navigate(s.id,s.q,1,'',e.target.value);};
  function sync(){
    for(const card of host.querySelectorAll(cardSelector)){const active=selected.has(key(card));card.classList.toggle('lb-selected',active);const box=card.querySelector('.lb-select');if(box)box.checked=active;}
    controls.querySelector('[data-count]').textContent=selected.size?`${selected.size}개 선택`:'';
    controls.querySelector('[data-move]').disabled=!selected.size||[...selected.values()].some(i=>!i.canMove);
    controls.querySelector('[data-move]').title=[...selected.values()].some(i=>!i.canMove)?'선택 항목 중 이동 권한이 없는 자료가 있습니다.':'선택한 파일·폴더 이동';
    trash.disabled=!selected.size||[...selected.values()].some(i=>!i.canDelete);
  }
  function select(card,event){
    const k=key(card),item=lookup(k);if(!item||(item.kind==='folder'&&!item.canMove))return;
    const keys=[...new Set([...host.querySelectorAll(cardSelector)].filter(n=>n.querySelector('.lb-select')).map(key))];
    if(event.shiftKey&&anchor&&keys.includes(anchor)){
      const [a,b]=[keys.indexOf(anchor),keys.indexOf(k)].sort((a,b)=>a-b);for(const id of keys.slice(a,b+1)){const row=lookup(id);if(row)selected.set(id,row);}
    }else{if(selected.has(k))selected.delete(k);else selected.set(k,item);anchor=k;}
    sync();
  }
  function all(){for(const card of host.querySelectorAll(cardSelector)){const item=lookup(key(card));if(item&&(item.kind==='file'||item.canMove))selected.set(key(card),item);}sync();}
  controls.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.view)setMode(b.dataset.view);if(b.hasAttribute('data-select-all'))all();if(b.hasAttribute('data-clear')){selected.clear();sync();}if(b.hasAttribute('data-move'))void openMove([...selected.values()]);};
  const dialog=el('dialog');dialog.className='lb-bulk-move';dialog.innerHTML='<h3>선택 항목 이동</h3><p data-path></p><div data-folders></div><p role="alert" data-error></p><div class="lb-toolbar"><button data-cancel>취소</button><button data-submit>이 폴더로 이동</button></div>';host.append(dialog);let target,moveGeneration=0;
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{moveGeneration++;});
  async function browse(id){
    const g=++moveGeneration;target=null;dialog.querySelector('[data-submit]').disabled=true;
    try{const view=await api('/api/data-core/library/folders?counts=0&parentId='+encodeURIComponent(id));if(g!==moveGeneration)return;target=view.folder;dialog.querySelector('[data-path]').textContent=view.breadcrumbs.map(b=>b.title).join(' > ');const list=dialog.querySelector('[data-folders]');list.replaceChildren();
      for(const f of [...(target.parentId?[{id:target.parentId,title:'상위 폴더',canWrite:true}]:[]),...view.folders.filter(f=>f.canWrite&&!moveItems.some(i=>i.kind==='folder'&&i.id===f.id))]){const b=el('button',f.title);b.onclick=()=>void browse(f.id);list.append(b);}
      dialog.querySelector('[data-submit]').disabled=!target.canWrite||!target.category;
    }catch(e){dialog.querySelector('[data-error]').textContent=e.message;}
  }
  async function openMove(items,targetId){if(!items.length||items.some(i=>!i.canMove))return;moveItems=items;requestId=crypto.randomUUID();dialog.querySelector('[data-error]').textContent='';dialog.querySelector('h3').textContent=`${items.length}개 항목 이동`;dialog.showModal();await browse(targetId||items[0].folderId||state.folder.id);}
  dialog.querySelector('[data-submit]').onclick=async()=>{
    if(!target)return;const b=dialog.querySelector('[data-submit]');b.disabled=true;
    try{await api('/api/data-core/library/move',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,targetId:target.id,items:moveItems.map(i=>({kind:i.kind,id:i.id,revision:i.revision}))})});dialog.close();selected.clear();await load();}
    catch(e){dialog.querySelector('[data-error]').textContent=e.message;}finally{b.disabled=false;}
  };
  const locate=file=>navigate(file.folderId,'',1,file.id);
  const trashDialog=el('dialog');trashDialog.className='lb-bulk-move';trashDialog.innerHTML='<h3>선택 항목을 휴지통으로 이동할까요?</h3><p data-names></p><p>하위 폴더가 있는 폴더는 삭제되지 않습니다.</p><p role="alert" data-result></p><div class="lb-toolbar"><button data-cancel>닫기</button><button data-confirm>휴지통으로 이동</button></div>';host.append(trashDialog);let removing=[];
  trash.onclick=()=>{removing=[...selected.values()];trashDialog.querySelector('[data-names]').textContent=removing.map(i=>i.title||i.fileName).join(', ');trashDialog.querySelector('[data-result]').textContent='';trashDialog.querySelector('[data-confirm]').disabled=false;trashDialog.showModal();};
  trashDialog.querySelector('[data-cancel]').onclick=()=>trashDialog.close();
  trashDialog.querySelector('[data-confirm]').onclick=async()=>{const b=trashDialog.querySelector('[data-confirm]');b.disabled=true;const failed=[];let done=0;
    for(const item of removing){try{await api(`/api/data-core/library/${item.kind==='file'?'files':'folders'}/${encodeURIComponent(item.id)}`,{method:'DELETE'});selected.delete(item.kind+':'+item.id);done++;}catch(e){failed.push({...item,error:e.message});}}
    removing=failed;await load();trashDialog.querySelector('[data-result]').textContent=`완료 ${done}개 · 실패 ${failed.length}개${failed.length?'\n'+failed.map(i=>(i.title||i.fileName)+': '+i.error).join('\n'):''}`;b.textContent='실패 항목 재시도';b.disabled=!failed.length;
  };
  host.addEventListener('click',e=>{
    const card=e.target.closest(cardSelector),box=e.target.closest('.lb-select');
    if(card&&(box||((e.ctrlKey||e.metaKey||e.shiftKey)&&!e.target.closest('button,details,.lb-file-actions,[data-lb-locate]')))){if(!box)e.preventDefault();e.stopImmediatePropagation();select(card,e);return;}
    const path=e.target.closest('[data-lb-locate]');if(path){e.preventDefault();e.stopImmediatePropagation();const f=lookup('file:'+path.dataset.lbLocate);if(f)locate(f);return;}
    const preview=e.target.closest('[data-lb-preview],[data-lb-image]');
    if(card&&!e.target.closest('button,input,details,.lb-file-actions')&&e.detail!==0){
      const item=lookup(key(card));if(item&&(item.kind==='file'||item.canMove)){e.preventDefault();e.stopImmediatePropagation();if(e.detail===1){selected.clear();selected.set(key(card),item);anchor=key(card);sync();}return;}
    }
    if(preview){e.preventDefault();e.stopImmediatePropagation();const file=lookup('file:'+(preview.dataset.lbPreview||preview.dataset.lbImage));if(file)void previewFile(file);}
    const folderMove=e.target.closest('[data-lb-move-custom]');if(folderMove){e.stopImmediatePropagation();const f=lookup('folder:'+folderMove.dataset.lbMoveCustom);if(f)void openMove([f]);}
  },true);
  const previewFile=file=>openPreview(file,locate,[...new Map([...state.files,...state.recent].map(f=>[f.id,f])).values()],ctx.cachedOriginal);
  host.addEventListener('dblclick',e=>{const card=e.target.closest(cardSelector);if(!card||e.target.closest('button,input,details,.lb-file-actions'))return;const item=lookup(key(card));if(!item)return;e.preventDefault();if(item.kind==='folder')navigate(item.id);else void previewFile(item);});
  host.addEventListener('keydown',e=>{
    if(e.target.closest('input:not([type="checkbox"]),textarea,select,dialog,[contenteditable]'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();all();}
    if(e.key==='Escape'){selected.clear();sync();}
  });
  host.addEventListener('dragstart',e=>{
    const card=e.target.closest(cardSelector);if(!card)return;const item=lookup(key(card));if(!item?.canMove){e.preventDefault();return;}
    if(!selected.has(key(card))){selected.clear();selected.set(key(card),item);sync();}drag=[...selected.values()];
    if(drag.some(i=>!i.canMove)){drag=null;e.preventDefault();return;}e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-hi5-library','internal');
  });
  host.addEventListener('dragend',()=>{drag=null;host.querySelectorAll('.lb-drop-target').forEach(n=>n.classList.remove('lb-drop-target'));});
  host.addEventListener('dragover',e=>{const card=e.target.closest('[data-library-folder]');if(drag&&card&&lookup(key(card))?.canWrite){e.preventDefault();e.dataTransfer.dropEffect='move';card.classList.add('lb-drop-target');}});
  host.addEventListener('dragleave',e=>e.target.closest('[data-library-folder]')?.classList.remove('lb-drop-target'));
  host.addEventListener('drop',e=>{const card=e.target.closest('[data-library-folder]');if(drag&&card){e.preventDefault();e.stopPropagation();card.classList.remove('lb-drop-target');void openMove(drag,card.dataset.libraryFolder);drag=null;}});
  host.querySelector('#libraryBreadcrumb').addEventListener('dragover',e=>{const link=e.target.closest('[data-lb-folder]');if(drag&&link){e.preventDefault();e.dataTransfer.dropEffect='move';}});
  host.querySelector('#libraryBreadcrumb').addEventListener('drop',e=>{const link=e.target.closest('[data-lb-folder]');if(drag&&link){e.preventDefault();void openMove(drag,link.dataset.lbFolder);drag=null;}});
  let rectangle=null;
  host.querySelector('#libraryContents').addEventListener('pointerdown',e=>{
    if(e.button||e.pointerType==='touch'||e.target.closest('a,button,input,details,'+cardSelector))return;
    const box=el('div');box.className='lb-selection-rectangle';document.body.append(box);rectangle={x:e.clientX,y:e.clientY,box,original:new Map(e.ctrlKey||e.metaKey?selected:[])};e.preventDefault();
  });
  window.addEventListener('pointermove',e=>{if(!rectangle)return;const {x,y,box,original}=rectangle,left=Math.min(x,e.clientX),top=Math.min(y,e.clientY),right=Math.max(x,e.clientX),bottom=Math.max(y,e.clientY);Object.assign(box.style,{left:left+'px',top:top+'px',width:right-left+'px',height:bottom-top+'px'});selected.clear();for(const [k,v] of original)selected.set(k,v);for(const card of host.querySelectorAll(cardSelector)){const r=card.getBoundingClientRect();if(r.left<right&&r.right>left&&r.top<bottom&&r.bottom>top){const i=lookup(key(card));if(i&&(i.kind==='file'||i.canMove))selected.set(key(card),i);}}sync();});
  const end=()=>{rectangle?.box.remove();rectangle=null;};window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
  function render(){
    const s=locationState(),scope=s.id+'|'+s.q;if(selectionOrigin!==scope){selected.clear();selectionOrigin=scope;}controls.querySelector('select').value=s.sort;
    for(const card of host.querySelectorAll(cardSelector)){
      const item=lookup(key(card));if(!item)continue;
      if((item.kind==='file'||item.canMove)&&!card.querySelector('.lb-select')){const box=el('input');box.type='checkbox';box.className='lb-select';box.setAttribute('aria-label',`${item.title||item.fileName} 선택`);card.prepend(box);card.draggable=!!item.canMove;}
      if(item.kind==='file'){
        const main=card.querySelector('.lb-file-main'),symbol=main?.querySelector(':scope > svg');if(symbol){const visual=el('div');visual.className='lb-document-visual';symbol.replaceWith(visual);visual.append(symbol,el('span',item.fileName.split('.').pop().toUpperCase()));}
        const path=(item.path||state.breadcrumbs).map(p=>p.title).join(' > ');let line=card.querySelector('.lb-full-path');
        if(!line){line=el('button');line.type='button';line.className='lb-full-path';line.dataset.lbLocate=item.id;card.querySelector('.lb-file-main')?.append(line);}line.textContent=path;line.title=path;
        const name=card.querySelector('.lb-recent-text>a');if(name)name.dataset.lbPreview=item.id;
        if(card.dataset.recentFile&&!card.querySelector('[data-lb-preview-button]')){const b=el('button','미리보기');b.dataset.lbPreview=item.id;b.dataset.lbPreviewButton='true';card.querySelector('.lb-file-actions').prepend(b);}
      }else if(item.canMove&&!card.querySelector('[data-lb-move-custom]')){const b=el('button','이동');b.type='button';b.dataset.lbMoveCustom=item.id;card.querySelector('details>div')?.prepend(b);}
    }sync();
  }
  setupUploads(ctx);return {render};
}
