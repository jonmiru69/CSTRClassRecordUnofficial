/* xlsx-js-style does not serialize pageSetup. Set the actual OOXML print
   properties after serialization, so Excel and LibreOffice receive them. */
(function (root) {
  'use strict';
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const parse = xml => new DOMParser().parseFromString(xml, 'application/xml');
  const serialize = xml => new XMLSerializer().serializeToString(xml);
  function element(doc, name, attrs) {
    const node = doc.createElementNS(ns, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
  async function build(workbook) {
    if (!root.XLSX || !root.JSZip) throw new Error('Excel export libraries are unavailable. Refresh and retry.');
    const zip = await root.JSZip.loadAsync(root.XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true }));
    for (let index = 0; index < workbook.SheetNames.length; index++) {
      const path = `xl/worksheets/sheet${index + 1}.xml`;
      const doc = parse(await zip.file(path).async('string'));
      const sheet = doc.documentElement;
      let properties = sheet.getElementsByTagNameNS(ns, 'sheetPr')[0];
      if (!properties) { properties = element(doc, 'sheetPr', {}); sheet.insertBefore(properties, sheet.firstChild); }
      properties.querySelector('pageSetUpPr')?.remove();
      properties.appendChild(element(doc, 'pageSetUpPr', { fitToPage: 1, autoPageBreaks: 0 }));
      ['printOptions', 'pageMargins', 'pageSetup', 'headerFooter'].forEach(tag => [...sheet.getElementsByTagNameNS(ns, tag)].forEach(node => node.remove()));
      const afterPrint = [...sheet.children].find(node => ['rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'].includes(node.localName)) || null;
      sheet.insertBefore(element(doc, 'printOptions', { horizontalCentered: 1, gridLines: 0, headings: 0 }), afterPrint);
      sheet.insertBefore(element(doc, 'pageMargins', { left: .2, right: .2, top: .3, bottom: .3, header: .1, footer: .1 }), afterPrint);
      sheet.insertBefore(element(doc, 'pageSetup', { paperSize: 5, orientation: 'landscape', fitToWidth: 1, fitToHeight: 1, firstPageNumber: index + 1, useFirstPageNumber: 1 }), afterPrint);
      const footer = element(doc, 'headerFooter', {});
      const odd = element(doc, 'oddFooter', {}); odd.textContent = `&CPage ${index + 1} of ${workbook.SheetNames.length}`;
      footer.appendChild(odd); sheet.insertBefore(footer, afterPrint);
      zip.file(path, serialize(doc));
    }
    const doc = parse(await zip.file('xl/workbook.xml').async('string'));
    let names = doc.querySelector('definedNames');
    if (!names) {
      names = element(doc, 'definedNames', {});
      const before = [...doc.documentElement.children].find(n => ['calcPr', 'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'].includes(n.localName)) || null;
      doc.documentElement.insertBefore(names, before);
    }
    [...names.children].filter(n => n.getAttribute('name') === '_xlnm.Print_Area').forEach(n => n.remove());
    workbook.SheetNames.forEach((name, index) => {
      const node = element(doc, 'definedName', { name: '_xlnm.Print_Area', localSheetId: index });
      const range = root.XLSX.utils.decode_range(workbook.Sheets[name]['!ref']);
      node.textContent = `'${name.replace(/'/g, "''")}'!$A$1:$${root.XLSX.utils.encode_col(range.e.c)}$${range.e.r + 1}`;
      names.appendChild(node);
    });
    zip.file('xl/workbook.xml', serialize(doc));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }
  async function download(workbook, filename) {
    const blob = await build(workbook);
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  root.CSTRExcelExport = { build, download };
})(window);
