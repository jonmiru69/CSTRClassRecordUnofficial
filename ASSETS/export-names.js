(function(root) {
  'use strict';
  function title(value, name) {
    if (['Mr.', 'Ms.'].includes(value)) return value;
    return /^ms\.?\s/i.test(String(name || '').trim()) ? 'Ms.' : 'Mr.';
  }
  function format(name, selectedTitle) {
    const plain = String(name || '').replace(/\s+/gu, ' ').trim();
    if (!plain) return '';
    const prefix = title(selectedTitle, plain);
    return prefix + ' ' + plain.replace(/^(?:(?:mr|ms)\.?\s+)+/i, '');
  }
  root.CSTRExportNames = { title, format };
  if (typeof module === 'object' && module.exports) module.exports = root.CSTRExportNames;
})(typeof window === 'object' ? window : globalThis);
