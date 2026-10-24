/* Presentation only: one continuous underline for each primary action phrase. */
(() => {
  'use strict';
  let scheduled = false;
  const secondary = 'svg,script,style,small,[aria-hidden="true"],[data-action-secondary],.action-label,.action-copy,.theme-switch-track,.period-completion-dot,.card-level-badge,.card-archived-badge,.section-card-section,.section-card-weights,.section-card-link,.level-card-kicker,.recent-class-stat,.score-plus-note,.weight-preview';
  function enhance() {
    scheduled = false;
    document.querySelectorAll('button,summary,a[data-action],[role="button"]').forEach(control => {
      const root = control.querySelector('[data-action-emphasis]') || control;
      if (root.querySelector('.action-label')) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (!node.parentElement.closest(secondary) && /[\p{L}\p{N}]/u.test(node.textContent)) nodes.push(node);
      }
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      const start = first.textContent.search(/[\p{L}\p{N}]/u);
      const tail = [...last.textContent.matchAll(/[\p{L}\p{N}]/gu)].at(-1);
      // Keep spaces and inline formatting inside the phrase. Decorative leading
      // and trailing symbols, icons, and secondary card details stay outside.
      const range = document.createRange();
      range.setStart(first, start);
      range.setEnd(last, tail.index + tail[0].length);
      const label = document.createElement('span'); label.className = 'action-label';
      label.append(range.extractContents()); range.insertNode(label);
    });
  }
  const queue = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(enhance); } };
  new MutationObserver(queue).observe(document.body, {childList:true,subtree:true,characterData:true});
  enhance();
})();
