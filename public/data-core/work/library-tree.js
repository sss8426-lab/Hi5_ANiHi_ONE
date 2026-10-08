// Left folder tree for 자료보관함: the path to the open folder stays expanded and other folders open on demand.
// Folder links reuse [data-lb-folder], so hq-library.js navigation and permission checks apply unchanged.
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupTree(ctx){
  const {host,state,api}=ctx,tree=host.querySelector('#libraryTree');
  const list=tree.querySelector('[data-tree]'),children=new Map(),open=new Set(),loading=new Map();let generation=0,current='root';
  const hidden=folder=>window.DataCoreLibraryClient.navigationHidden(folder);
  function fetchChildren(id){
    if(children.has(id))return Promise.resolve(children.get(id));
    if(!loading.has(id))loading.set(id,api(`/api/data-core/library/folders?counts=0&parentId=${encodeURIComponent(id)}`)
      .then(view=>{const rows=view.folders.filter(f=>!hidden(f));children.set(id,rows);return rows;})
      .finally(()=>loading.delete(id)));
    return loading.get(id);
  }
  function node(folder,depth){
    const kids=children.get(folder.id),expanded=open.has(folder.id)&&kids?.length,leaf=kids&&!kids.length;
    return `<li><div class="lb-tree-row${folder.id===current?' lb-tree-current':''}" style="--depth:${depth}">${leaf?'<span class="lb-tree-toggle"></span>':`<button type="button" class="lb-tree-toggle" data-tree-toggle="${h(folder.id)}" aria-expanded="${expanded?'true':'false'}" aria-label="${h(folder.title)} ${expanded?'접기':'펼치기'}"></button>`}
      <a href="/data-core/work/library?folder=${encodeURIComponent(folder.id)}" data-lb-folder="${h(folder.id)}"${folder.id===current?' aria-current="page"':''}><svg class="lb-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Folder"></use></svg><span>${h(folder.title)}</span></a></div>
      ${expanded?`<ul>${kids.map(k=>node(k,depth+1)).join('')}</ul>`:''}</li>`;
  }
  function paint(){
    const top=children.get('root');if(!top)return;
    const scroll=tree.scrollTop;
    list.innerHTML=`<li><div class="lb-tree-row${current==='root'?' lb-tree-current':''}" style="--depth:0"><span class="lb-tree-toggle"></span><a href="/data-core/work/library" data-lb-folder="root"${current==='root'?' aria-current="page"':''}><svg class="lb-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Folder"></use></svg><span>자료보관함</span></a></div></li>${top.map(f=>node(f,0)).join('')}`;
    tree.scrollTop=scroll;
    // Keep the open folder visible inside the tree only; scrollIntoView would also scroll the page.
    const row=list.querySelector('.lb-tree-current');if(!row||!reveal)return;reveal=false;
    const y=row.getBoundingClientRect().top-tree.getBoundingClientRect().top+tree.scrollTop;
    if(y<tree.scrollTop||y+row.offsetHeight>tree.scrollTop+tree.clientHeight)tree.scrollTop=Math.max(0,y-tree.clientHeight/3);
  }
  let painted='',reveal=false;
  async function sync(){
    if(!state.folder)return;
    const key=state.folder.id+'|'+state.folders.map(f=>f.id+':'+f.title).join(',');
    if(key===painted)return;painted=key;
    const g=++generation;reveal=current!==state.folder.id||!children.has('root');current=state.folder.id;
    // The open folder's own children are already fresh from this load, so new or renamed folders show at once.
    if(current!=='root'){children.set(current,state.folders.filter(f=>!hidden(f)));open.add(current);}
    else children.set('root',state.folders.filter(f=>!hidden(f)));
    try{
      await fetchChildren('root');
      for(const crumb of state.breadcrumbs.slice(0,-1)){if(crumb.id==='root')continue;await fetchChildren(crumb.id);open.add(crumb.id);}
    }catch{/* The tree is a shortcut; the breadcrumb and folder grid still work when a branch fails to load. */}
    if(g===generation)paint();
  }
  tree.addEventListener('click',async e=>{
    const toggle=e.target.closest('[data-tree-toggle]');if(!toggle)return;
    const id=toggle.dataset.treeToggle;
    if(open.has(id)&&children.get(id)?.length){open.delete(id);paint();return;}
    open.add(id);toggle.setAttribute('aria-busy','true');
    try{await fetchChildren(id);}catch{open.delete(id);}
    paint();host.querySelector(`#libraryTree [data-tree-toggle="${CSS.escape(id)}"]`)?.focus();
  });
  host.querySelector('#libraryRefresh')?.addEventListener('click',()=>{children.clear();open.clear();painted='';});
  return {sync};
}
