/* Apply the teacher's explicit choice before the first stylesheet paints. */
(() => {
  const key = 'cstr-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let ripple;
  let resumeTransitions;
  const saved = () => {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  };
  const storedTheme = saved();
  let choice = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null;
  const current = () => choice ?? (system.matches ? 'dark' : 'light');
  const apply = theme => {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-toggle-theme]').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
      button.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
      const label = button.querySelector('.theme-toggle-label');
      if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
    });
  };

  function switchPalette() {
    // Apply every surface and its text in the same paint, including when motion is off.
    root.dataset.themeSwitching = '';
    apply(current());
    cancelAnimationFrame(resumeTransitions);
    resumeTransitions = requestAnimationFrame(() => {
      resumeTransitions = requestAnimationFrame(() => delete root.dataset.themeSwitching);
    });
  }

  function revealTheme(button) {
    const rect = button.getBoundingClientRect();
    const width = root.clientWidth;
    const height = root.clientHeight;
    const x = Math.max(0, Math.min(width, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(height, rect.top + rect.height / 2));
    const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y))) + 1;

    root.style.setProperty('--theme-ripple-origin', `${x}px ${y}px`);
    root.style.setProperty('--theme-ripple-radius', `${radius}px`);
    root.dataset.themeRipple = '';
    button.dataset.themeLift = '';

    const transition = document.startViewTransition(switchPalette);
    ripple = transition;
    const cleanup = () => {
      delete button.dataset.themeLift;
      delete root.dataset.themeRipple;
      root.style.removeProperty('--theme-ripple-origin');
      root.style.removeProperty('--theme-ripple-radius');
      ripple = undefined;
    };
    // An interrupted capture still runs switchPalette with the most recent choice.
    transition.ready.catch(() => {});
    transition.finished.then(cleanup, cleanup);
  }

  apply(current());
  document.addEventListener('DOMContentLoaded', () => apply(current()), { once: true });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-toggle-theme]');
    if (!button) return;
    choice = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, choice); } catch (_) {}
    if (ripple) ripple.skipTransition();
    else if (event.detail && !reducedMotion.matches && document.startViewTransition
      && CSS.supports('selector(::view-transition-new(root))') && document.visibilityState === 'visible') {
      revealTheme(button);
      return;
    }
    switchPalette();
  });
  system.addEventListener('change', () => { if (!choice) switchPalette(); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) ripple?.skipTransition(); });
})();
