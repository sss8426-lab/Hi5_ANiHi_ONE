(function () {
  'use strict';
  window.DataCoreLibraryClient = {
    async browse(api, { id = 'root', q = '', page = 1 } = {}, options = {}) {
      const [view, listing] = await Promise.all([
        api(`/api/data-core/library/folders?parentId=${encodeURIComponent(id)}`, options),
        api(`/api/data-core/library/files?folderId=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}&page=${page}`, options),
      ]);
      return { view, listing };
    },
  };
})();
