/* Presentation only: underline primary words, never card metadata or symbols. */
(() => {
  'use strict';
  let scheduled = false;
  const secondary = 'svg,script,style,small,[aria-hidden="true"],[data-action-secondary],.action-label,.action-copy,.theme-switch-track,.period-completion-dot,.card-level-badge,.card-archived-badge,.section-card-section,.section-card-weights,.section-card-link,.level-card-kicker,.recent-class-stat,.score-plus-note,.weight-preview';
  function enhance() {
    scheduled = false;
    document.querySelectorAll('button,summary').forEach(control => {
      const emphasis = control.querySelectorAll('[data-action-emphasis]');
      const roots = emphasis.length ? [...emphasis] : [control];
      roots.forEach(root => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
        let node;
        while ((node = walker.nextNode())) {
          if (!node.parentElement.closest(secondary) && /[\p{L}\p{N}]/u.test(node.textContent)) nodes.push(node);
        }
        nodes.forEach(text => {
          const fragment = document.createDocumentFragment();
          let cursor = 0;
          // Each word owns its underline, including when a label wraps to another line.
          // Whitespace, punctuation, marks and emoji remain unadorned text.
          for (const match of text.textContent.matchAll(/[\p{L}\p{N}]+/gu)) {
            fragment.append(document.createTextNode(text.textContent.slice(cursor, match.index)));
            const label = document.createElement('span'); label.className = 'action-label'; label.textContent = match[0];
            fragment.append(label); cursor = match.index + match[0].length;
          }
          fragment.append(document.createTextNode(text.textContent.slice(cursor)));
          const copy = document.createElement('span'); copy.className = 'action-copy';
          copy.append(fragment); text.replaceWith(copy);
        });
      });
    });
  }
  const queue = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(enhance); } };
  new MutationObserver(queue).observe(document.body, {childList:true,subtree:true,characterData:true});
  enhance();
})();
