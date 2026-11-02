/* Campus cover motion only. No account, record, grading or storage access. */
(() => {
  'use strict';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  function paint() {
    frame = 0;
    const cover = document.querySelector('.welcome-story');
    if (!cover) return;
    const y = cover.getBoundingClientRect().top;
    const travel = motion.matches ? 0 : Math.max(-18, Math.min(18, (80 - y) * .055));
    cover.style.setProperty('--cover-travel', `${travel.toFixed(2)}px`);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  addEventListener('scroll', schedule, {passive: true});
  addEventListener('resize', schedule, {passive: true});
  motion.addEventListener('change', schedule);
  schedule();
})();
