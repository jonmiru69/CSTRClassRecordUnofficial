/* Apply the teacher's explicit choice before the first stylesheet paints. */
(() => {
  const key = 'cstr-theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  };
  const current = () => {
    const choice = saved();
    return choice === 'light' || choice === 'dark' ? choice : system.matches ? 'dark' : 'light';
  };
  const apply = theme => {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-toggle-theme]').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
      button.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
      const icon = button.querySelector('.theme-toggle-icon');
      if (icon) icon.textContent = dark ? '☀' : '☾';
      const label = button.querySelector('.theme-toggle-label');
      if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
    });
  };
  apply(current());
  document.addEventListener('DOMContentLoaded', () => apply(current()), { once: true });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-toggle-theme]')) return;
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, next); } catch (_) {}
    apply(next);
  });
  system.addEventListener('change', () => { if (!saved()) apply(current()); });
})();
