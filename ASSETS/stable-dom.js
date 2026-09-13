/* Patch a workspace in place: retain focused inputs, scroll containers and
   keyed assessment cells when adjacent columns are inserted or removed. */
(function (root) {
  'use strict';
  function key(node) {
    if (node.nodeType !== 1) return null;
    const d = node.dataset;
    if (node.matches('.table-wrap,.record-table,.app-main,.app-shell,.record-section')) return 'container:' + node.className;
    if (node.id) return 'id:' + node.id;
    if (d.learnerRow !== undefined) return 'row:' + d.learnerRow;
    if (d.score) return `score:${d.score}:${d.row}:${d.index}`;
    if (d.hps) return `hps:${d.hps}:${d.index}`;
    if (d.date) return `date:${d.date}:${d.index}`;
    if (d.nameRow !== undefined) return 'name:' + d.nameRow;
    if (d.period !== undefined) return 'period:' + d.period;
    if (node.matches('th,td')) {
      const input = node.querySelector('input');
      if (input) return node.tagName + ':' + key(input);
      if (node.className) return node.tagName + ':' + node.className;
    }
    if (d.action) return `action:${d.action}:${d.kind || ''}:${d.section || ''}:${d.subject || ''}`;
    return null;
  }
  function compatible(a, b) { return a && a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b); }
  function patch(old, next) {
    if (old.nodeType === 3 || old.nodeType === 8) { if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue; return; }
    const focused = old === document.activeElement;
    for (const attribute of Array.from(old.attributes)) {
      if (old.matches('.table-wrap') && attribute.name === 'style') continue;
      if (old.tagName === 'DETAILS' && attribute.name === 'open') continue;
      if (!next.hasAttribute(attribute.name)) old.removeAttribute(attribute.name);
    }
    for (const attribute of next.attributes) {
      if (old.getAttribute(attribute.name) !== attribute.value) old.setAttribute(attribute.name, attribute.value);
    }
    if (old.matches('input,textarea')) {
      // A bulk paste or row deletion can change even the focused field.
      // Leave unchanged values alone so typing retains its caret naturally.
      if (old.value !== next.value) {
        const start = old.selectionStart, end = old.selectionEnd;
        old.value = next.value;
        if (focused && start !== null && typeof old.setSelectionRange === 'function') {
          old.setSelectionRange(Math.min(start, old.value.length), Math.min(end, old.value.length));
        }
      }
      if ('checked' in old) old.checked = next.checked;
      old.disabled = next.disabled;
      return;
    }
    // Consume each old sibling once. Summary cells can share a class/key;
    // a single-value Map incorrectly reuses the same cell several times.
    const remaining = new Set(Array.from(old.childNodes));
    let cursor = old.firstChild;
    for (const child of Array.from(next.childNodes)) {
      const match = Array.from(remaining).find(node => compatible(node, child));
      if (match) {
        remaining.delete(match);
        if (match !== cursor) old.insertBefore(match, cursor);
        patch(match, child);
        cursor = match.nextSibling;
      } else {
        const inserted = child.cloneNode(true);
        old.insertBefore(inserted, cursor);
        cursor = inserted.nextSibling;
      }
    }
    for (const node of remaining) node.remove();
    if (old.tagName === 'SELECT' && !focused) old.value = next.value;
  }
  root.CSTRStableDOM = { patch };
})(window);
