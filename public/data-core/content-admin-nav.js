(async () => {
  const adminLinks = Array.from(document.querySelectorAll('[data-super-admin-nav]'));
  if (!adminLinks.length) return;

  adminLinks.forEach((link) => link.classList.add('hidden'));
  try {
    const response = await fetch('/api/data-core/context', {
      cache: 'no-store',
      credentials: 'include',
    });
    if (!response.ok) return;
    const context = await response.json();
    const visible = Boolean(context?.authenticated && context?.isSuperAdmin);
    adminLinks.forEach((link) => link.classList.toggle('hidden', !visible));
  } catch {
    adminLinks.forEach((link) => link.classList.add('hidden'));
  }
})();
