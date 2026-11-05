/* Presentation only: one continuous underline for each primary action phrase. */
(() => {
  'use strict';
  let scheduled = false;
  const pending = new Set();
  const controls = 'button,summary,a[data-action],[role="button"]';
  const secondary = 'svg,script,style,small,[aria-hidden="true"],[data-action-secondary],.action-label,.action-copy,.theme-switch-track,.period-completion-dot,.card-level-badge,.card-archived-badge,.section-card-section,.section-card-weights,.section-card-link,.level-card-kicker,.recent-class-stat,.score-plus-note,.weight-preview';
  function enhance() {
    scheduled = false;
    const batch = [...pending];
    pending.clear();
    batch.forEach(control => {
      if (!control.isConnected) return;
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
  new MutationObserver(records => {
    for (const record of records) {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const parent = element?.closest(controls);
      if (parent && !parent.querySelector('.action-label')) pending.add(parent);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(controls)) pending.add(node);
        node.querySelectorAll(controls).forEach(control => pending.add(control));
      }
    }
    if (pending.size && !scheduled) {
      scheduled = true;
      requestAnimationFrame(enhance);
    }
  }).observe(document.body, {childList:true,subtree:true,characterData:true});
  document.querySelectorAll(controls).forEach(control => pending.add(control));
  enhance();
})();
