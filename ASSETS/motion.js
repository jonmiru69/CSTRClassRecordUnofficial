/* Delegated, frame-limited motion: works on newly rendered controls as well. */
(() => {
  const fine = matchMedia('(hover:hover) and (pointer:fine)');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const surfaces = '.login-card,.metric-card,.section-card-wrap,.level-card,.recent-class-row';
  let active = null, frame = 0, px = 0, py = 0;
  const reset = () => {
    if (!active) return;
    active.style.removeProperty('--tilt-x'); active.style.removeProperty('--tilt-y');
    active = null;
  };
  document.addEventListener('pointermove', event => {
    if (!fine.matches || reduced.matches) return;
    const surface = event.target.closest(surfaces);
    if (active !== surface) { reset(); active = surface; }
    if (!active) return;
    px = event.clientX; py = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!active?.isConnected) return reset();
      const r = active.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (px-r.left)/r.width));
      const y = Math.max(0, Math.min(1, (py-r.top)/r.height));
      active.style.setProperty('--tilt-x', ((.5-y)*5).toFixed(2)+'deg');
      active.style.setProperty('--tilt-y', ((x-.5)*5).toFixed(2)+'deg');
      active.style.setProperty('--light-x', x*100+'%');
      active.style.setProperty('--light-y', y*100+'%');
    });
  }, {passive:true});
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) reset(); }, {passive:true});
  window.addEventListener('blur',reset);
  reduced.addEventListener('change',reset);
  document.addEventListener('pointerdown', event => {
    if (reduced.matches || !fine.matches || event.button !== 0) return;
    const button = event.target.closest('button,summary');
    if (!button || button.disabled) return;
    const ripple = document.createElement('span');
    ripple.className='motion-ripple'; ripple.setAttribute('aria-hidden','true');
    ripple.style.left=event.clientX+'px'; ripple.style.top=event.clientY+'px';
    document.body.append(ripple);
    ripple.addEventListener('animationend',()=>ripple.remove(),{once:true});
    setTimeout(()=>ripple.remove(),800);
  },{passive:true});
})();
