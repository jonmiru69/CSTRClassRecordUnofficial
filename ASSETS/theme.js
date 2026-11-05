/* Apply the teacher's explicit choice before the first stylesheet paints. */
(() => {
  const key = 'cstr-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let ripple;
  const saved = () => {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  };
  const storedTheme = saved();
  let choice = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null;
  const current = () => choice ?? (system.matches ? 'dark' : 'light');
  const apply = theme => {
    root.dataset.theme = theme;
    const dark = theme === 'dark';
    document.querySelectorAll('[data-toggle-theme]').forEach(button => {
      button.setAttribute('aria-checked', String(dark));
      button.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
    });
  };

  function revealTheme(button) {
    const rect = button.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const x = Math.max(0, Math.min(width, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(height, rect.top + rect.height / 2));
    const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y))) + 1;

    const wave = document.createElement('span');
    wave.className = 'theme-wave';
    wave.setAttribute('aria-hidden', 'true');
    wave.style.left = `${x - 64}px`;
    wave.style.top = `${y - 64}px`;
    root.dataset.themeRipple = '';
    button.dataset.themeLift = '';

    const transition = document.startViewTransition(() => {
      apply(current());
      document.body.append(wave);
    });
    ripple = transition;
    const cleanup = () => {
      delete button.dataset.themeLift;
      delete root.dataset.themeRipple;
      wave.remove();
      ripple = undefined;
    };
    // An interrupted capture still applies the most recent choice.
    transition.ready.then(() => {
      try {
        // Scale a small, already painted wave. The page snapshots only fade.
        const fullScale = (radius + 16) / 64;
        const reveal = root.animate([
          { transform: 'scale(.18)', opacity: 0, offset: 0 },
          { transform: `scale(${fullScale * .24})`, opacity: .82, offset: .24 },
          { transform: `scale(${fullScale * .76})`, opacity: .48, offset: .76 },
          { transform: `scale(${fullScale})`, opacity: 0, offset: 1 }
        ], { pseudoElement: '::view-transition-new(theme-wave)', duration: 340, fill: 'both' });
        if (reveal.effect.pseudoElement !== '::view-transition-new(theme-wave)') {
          reveal.cancel();
          transition.skipTransition();
          return;
        }
        reveal.id = 'theme-ripple';
      } catch (_) {
        transition.skipTransition();
      }
    }, () => {});
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
    apply(current());
  });
  system.addEventListener('change', () => { if (!choice) apply(current()); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) ripple?.skipTransition(); });
})();
