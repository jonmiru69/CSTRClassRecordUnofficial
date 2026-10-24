/* Presentation-only text wrappers. No record values, calculations or storage. */
(() => {
  'use strict';
  let scheduled = false;
  function enhance() {
    scheduled = false;
    document.querySelectorAll('button,summary').forEach(control => {
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      const nodes = []; let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim() || node.parentElement.closest('svg,.action-label,script,style,.theme-switch-track')) continue;
        nodes.push(node);
      }
      nodes.forEach(text => {
        const label = document.createElement('span'); label.className = 'action-label';
        text.replaceWith(label); label.append(text);
      });
    });
  }
  const queue = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(enhance); } };
  new MutationObserver(queue).observe(document.body, {childList:true, subtree:true});
  enhance();
})();
