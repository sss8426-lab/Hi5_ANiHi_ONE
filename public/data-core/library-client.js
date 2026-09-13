(function () {
  'use strict';
  window.DataCoreLibraryClient = {
    folderGroups(view, query = '') {
      const groups = new Map();
      const search = query.trim().toLocaleLowerCase('ko-KR');
      for (const folder of view.folders || []) {
        if (search && !folder.title.toLocaleLowerCase('ko-KR').includes(search)) continue;
        const group = view.folder.id === 'root' ? folder.group || '폴더' : '폴더';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(folder);
      }
      return [...groups];
    },
    async browse(api, { id = 'root', q = '', page = 1 } = {}, options = {}) {
      const [view, listing] = await Promise.all([
        api(`/api/data-core/library/folders?parentId=${encodeURIComponent(id)}`, options),
        api(`/api/data-core/library/files?folderId=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}&page=${page}`, options),
      ]);
      return { view, listing };
    },
  };
})();
