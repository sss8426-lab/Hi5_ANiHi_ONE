// Presentation enhancement only: reuse existing navigation nodes and handlers.
import './session-activity.js?v=20260912-campus';
const ns = 'http://www.w3.org/2000/svg';
function icon(name) {
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('core-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `/data-core/assets/core-icons.svg#${name}`);
  svg.append(use);
  return svg;
}
const symbols = new Map([['⌂','House'],['☆','Trophy'],['◇','Compass'],['◎','GraduationCap'],['←','ArrowLeft'],['▦','Folder'],['✎','PenLine'],['▧','Image'],['↺','RotateCcw'],['✓','ShieldCheck'],['⚙','Settings'],['▣','Users'],['◫','BookOpen'],['♙','Users'],['↗','Users']]);
function replaceIcons(root) {
  for (const node of root.querySelectorAll('.nav-icon, .feature-icon, .kk-nav a > span:first-child')) {
    const name = symbols.get(node.textContent.trim());
    if (name) node.replaceChildren(icon(name));
  }
}
replaceIcons(document);
// Some existing feature links are inserted after the app's permission check.
const shell = document.querySelector('.app-shell, .kk-shell');
if (shell) new MutationObserver(records => {
  if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && !node.closest?.('svg')))) replaceIcons(shell);
}).observe(shell, {childList: true, subtree: true});

const sidebar = document.querySelector('.sidebar, .kk-sidebar');
if (sidebar && typeof HTMLDialogElement !== 'undefined' && 'showModal' in HTMLDialogElement.prototype) {
  const anchor = document.createComment('desktop sidebar position');
  sidebar.before(anchor);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'core-menu-toggle';
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-controls', 'coreNavigation');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(icon('Menu'), document.createTextNode('메뉴'));
  const container = document.querySelector('.app-shell, .kk-shell, .app');
  container.before(toggle);
  const dialog = document.createElement('dialog');
  dialog.id = 'coreNavigation';
  dialog.className = 'core-nav-dialog';
  dialog.setAttribute('aria-label', '기능 메뉴');
  const closeRow = document.createElement('div');
  closeRow.className = 'core-nav-close';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', '메뉴 닫기');
  close.title = '메뉴 닫기';
  close.append(icon('X'));
  closeRow.append(close);
  dialog.append(closeRow);
  document.body.append(dialog);
  const media = matchMedia('(max-width: 1100px)');
  function syncLayout() {
    if (media.matches) dialog.append(sidebar);
    else { dialog.close(); anchor.after(sidebar); }
  }
  toggle.addEventListener('click', () => { dialog.showModal(); toggle.setAttribute('aria-expanded', 'true'); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    if (event.target.closest('.nav-item, .kk-nav a, #nav [data-page], .back-link')) dialog.close();
  });
  media.addEventListener('change', syncLayout);
  syncLayout();
}
