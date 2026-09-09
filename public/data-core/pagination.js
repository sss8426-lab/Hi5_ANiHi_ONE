export function paginate(items, requestedPage = 1, pageSize = 4) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  const pages = [...new Set([1, totalPages, ...Array.from({length:5}, (_, i) => page + i - 2)])]
    .filter(n => n >= 1 && n <= totalPages).sort((a,b) => a-b);
  const buttons = [];
  pages.forEach((n, i) => { if (i && n - pages[i-1] > 1) buttons.push(null); buttons.push(n); });
  return {page, totalPages, buttons, rows:items.slice((page-1)*pageSize, page*pageSize)};
}
