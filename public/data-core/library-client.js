(function () {
  'use strict';
  const clients = new WeakMap();
  const hidden = folder => Boolean(folder && (folder.navigationHidden || folder.parentId === 'hq' || folder.id === 'hq' || folder.id.startsWith('hq-default:')));
  // Share only in-flight reads. Settled metadata is never reused without authorization.
  function request(api, url, options) {
    const {signal, ...rest} = options;
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    let pending = clients.get(api); if (!pending) clients.set(api, pending = new Map());
    let entry = pending.get(url);
    if (!entry) {
      const controller = new AbortController();
      entry = {controller, users:0, done:false};
      entry.promise = Promise.resolve().then(() => api(url, {...rest, signal:controller.signal})).finally(() => {
        entry.done = true; if (pending.get(url) === entry) pending.delete(url);
      });
      pending.set(url, entry);
    }
    entry.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, value) => {
        if (finished) return; finished = true; signal?.removeEventListener('abort', abort);
        if (--entry.users === 0 && !entry.done) {pending.delete(url); entry.controller.abort();}
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(new DOMException('Cancelled','AbortError'));
      signal?.addEventListener('abort', abort, {once:true});
      entry.promise.then(value => finish(null,value), finish);
    });
  }
  window.DataCoreLibraryClient = {
    navigationHidden: hidden,
    folderGroups(view, query = '') {
      const groups = new Map();
      const search = query.trim().toLocaleLowerCase('ko-KR');
      for (const folder of view.folders || []) {
        // Also handle stale root responses without hiding similarly named campus folders.
        if (hidden(folder)) continue;
        if (search && !folder.title.toLocaleLowerCase('ko-KR').includes(search)) continue;
        const group = view.folder.id === 'root' ? folder.group || '폴더' : '폴더';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(folder);
      }
      return [...groups];
    },
    async browse(api, { id = 'root', q = '', page = 1 } = {}, options = {}) {
      const {onView,onListing,skipFolders=false,counts=true,skipEmptyRoot=false, ...requestOptions} = options;
      const folder = skipFolders ? Promise.resolve(null) : request(api,`/api/data-core/library/folders?parentId=${encodeURIComponent(id)}${counts?'':'&counts=0'}`,requestOptions)
        .then(view => {if(!requestOptions.signal?.aborted&&!hidden(view.folder))onView?.(view);return view;});
      const files=skipEmptyRoot&&(id==='root'||id.startsWith('campus:'))?Promise.resolve({files:[],hasMore:false}):request(api,`/api/data-core/library/files?folderId=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}&page=${page}`,requestOptions);
      const results = await Promise.allSettled([folder,files.then(listing=>{if(!requestOptions.signal?.aborted&&!listing.navigationHidden)onListing?.(listing);return listing;})]);
      const rejected=results.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
      const [view,listing]=results.map(result=>result.value);
      if(hidden(view?.folder)&&id!=='root')return {...await this.browse(api,{id:'root'},options),redirected:true};
      return { view, listing };
    },
  };
})();
