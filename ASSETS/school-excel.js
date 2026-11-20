/* Fill the school's native OOXML template. Do not round-trip it through a cell
   serializer: that drops its logo, print settings, validation and native styles.
   All learner text is written as text, never interpreted as a formula. */
(function (root) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const parse = xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid school template XML.');
    return doc;
  };
  const serialize = doc => new XMLSerializer().serializeToString(doc);
  const col = index => { let text = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return text; };
  const colIndex = letters => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const address = value => { const match = /^([A-Z]+)(\d+)$/.exec(value); if (!match) throw new Error('Invalid cell address.'); return { c: colIndex(match[1]), r: Number(match[2]) }; };
  const el = (doc, name, attrs = {}) => { const node = doc.createElementNS(NS, name); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v))); return node; };
  const present = value => value !== null && value !== undefined && String(value).trim() !== '';
  const sum = terms => terms.length ? `SUM(${terms.join(',')})` : '0';
  const roleLabel = role => ({ st1: 'ST1', st2: 'ST2', te: 'TE', cognitive: 'Cognitive', affective: 'Affective', behavioral: 'Behavioral' })[role] || '';

  function validate(payload) {
    const { section, period } = payload;
    if (!section || !period || !Array.isArray(period.roster)) throw new Error('Open a class record first.');
    const issue = root.CSTRGrading.gradingIssue(section); if(issue)throw new Error(issue);
    const kinds = ['ww', 'pt', 'qa'];
    if (period.roster.some(learner => !present(learner.name) && kinds.some(kind => learner[kind]?.some(present)))) {
      throw new Error('Name the learner on every scored row.');
    }
    for (const [componentIndex, kind] of kinds.entries()) {
      const hps = period[kind + 'Hps'], dates = period[kind + 'Dates'];
      if (!Array.isArray(hps) || !Array.isArray(dates) || hps.length !== dates.length) throw new Error('Assessment columns are inconsistent.');
      if (hps.length > 1000) throw new Error('Too many assessment columns.');
      for (const learner of period.roster) {
        if (!Array.isArray(learner[kind]) || learner[kind].length !== hps.length) throw new Error('Learner scores and assessment columns do not align.');
      }
      if (section.weights[componentIndex] === 0) continue;
      const options = root.CSTRGrading.componentOptions(section, period, kind);
      hps.forEach((value, index) => {
        if (present(value) && (root.CSTRGrading.numberOrNull(value) === null || Number(value) <= 0)) throw new Error(`${kind.toUpperCase()} ${index + 1}: enter a positive HPS.`);
        if (present(value) && options.groups && !options.groups.some(g => g.id === options.roles[index])) throw new Error(`${kind.toUpperCase()} ${index + 1}: select its assessment group or domain in the activity register.`);
      });
      for (const learner of period.roster) {
        if (root.CSTRRecordTools?.getRowCategory(learner)) continue;
        learner[kind].forEach((value, index) => {
          if (!present(value)) return;
          const label = `${kind.toUpperCase()} ${index + 1}`;
          const problem = root.CSTRGrading.scoreIssue(value, hps[index]);
          if (problem === 'missingHps') throw new Error(`${label}: a score has no positive HPS.`);
          if (problem) throw new Error(`${label}: enter a score from zero to HPS or A, M, E, L.`);
        });
      }
    }
    if (period.roster.length > 10000) throw new Error('Too many learner rows.');
  }
  const sumNumbers = list => list.reduce((total, value) => total + value, 0);

  // Lay out in physical points at 100%. Excel's one-page fit mode ignores manual
  // breaks and shrinks the whole roster whenever activities/learners are added.
  async function layoutPrint({ zip, doc, stylesDoc, rows, cell, write, mapCol, mapRow,
    lastCol, lastLearnerRow, roleRow, rawColumns, register, payload }) {
    const sheet = doc.documentElement, { section, period, metadata = {} } = payload;
    const xfs = stylesDoc.getElementsByTagNameNS(NS, 'cellXfs')[0];
    const fonts = stylesDoc.getElementsByTagNameNS(NS, 'fonts')[0];
    const borders = stylesDoc.getElementsByTagNameNS(NS, 'borders')[0];
    const borderId = borders.children.length, border = el(stylesDoc, 'border');
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const edge = el(stylesDoc, side, { style: 'thin' });
      edge.appendChild(el(stylesDoc, 'color', { rgb: 'FF000000' })); border.appendChild(edge);
    }
    border.appendChild(el(stylesDoc, 'diagonal')); borders.appendChild(border);
    borders.setAttribute('count', borders.children.length);
    const fontCache = new Map(), styleCache = new Map();
    function style(node, { size = 8, grid = false, wrap = true, rotate = 0, bold = false, clearBorder = false } = {}) {
      const base = Number(node.getAttribute('s') || 0), key = [base, size, grid, wrap, rotate, bold, clearBorder].join('|');
      if (!styleCache.has(key)) {
        const xf = xfs.children[base].cloneNode(true), baseFont = Number(xf.getAttribute('fontId') || 0);
        const fontKey = [baseFont, size, bold].join('|');
        if (!fontCache.has(fontKey)) {
          const font = fonts.children[baseFont].cloneNode(true);
          let sz = font.getElementsByTagNameNS(NS, 'sz')[0];
          if (!sz) { sz = el(stylesDoc, 'sz'); font.appendChild(sz); }
          sz.setAttribute('val', size);
          if (bold && !font.getElementsByTagNameNS(NS, 'b').length) font.appendChild(el(stylesDoc, 'b'));
          fontCache.set(fontKey, fonts.children.length); fonts.appendChild(font);
        }
        xf.setAttribute('fontId', fontCache.get(fontKey)); xf.setAttribute('applyFont', '1');
        if (grid) { xf.setAttribute('borderId', borderId); xf.setAttribute('applyBorder', '1'); }
        if (clearBorder) { xf.setAttribute('borderId', '0'); xf.setAttribute('applyBorder', '1'); }
        let alignment = xf.getElementsByTagNameNS(NS, 'alignment')[0];
        if (!alignment) { alignment = el(stylesDoc, 'alignment'); xf.appendChild(alignment); }
        for (const [name, value] of Object.entries({ wrapText: +wrap, shrinkToFit: 0, textRotation: rotate, vertical: 'center' })) alignment.setAttribute(name, value);
        xf.setAttribute('applyAlignment', '1');
        styleCache.set(key, xfs.children.length); xfs.appendChild(xf);
      }
      node.setAttribute('s', styleCache.get(key));
      return Number(node.getAttribute('s'));
    }
    function height(r, points) {
      const row = rows.get(r); if (!row) return;
      row.setAttribute('ht', points); row.setAttribute('customHeight', '1'); row.removeAttribute('thickBot');
    }
    // Arial-11 column units differ slightly between screen and printer metrics.
    // Calibrated in Excel's Folio PDF output, with allowance for column rounding.
    const baseWidths = [16,101,...Array(10).fill(17),25,34,...Array(8).fill(17),25,34,23,23,23,26,26,26,30,34,35,40,71];
    const widths = new Map(baseWidths.map((width, c) => [mapCol(c), width]));
    for (const columns of Object.values(rawColumns)) for (const c of columns) if (!widths.has(c)) widths.set(c, 17);
    const cols = sheet.getElementsByTagNameNS(NS, 'cols')[0];
    cols.replaceChildren(...Array.from({ length: lastCol + 1 }, (_, c) =>
      el(doc, 'col', { min: c + 1, max: c + 1, width: (widths.get(c) / 5.65).toFixed(5), customWidth: 1 })));
    for (const [r, row] of rows) {
      if (r >= mapRow(70) && r !== roleRow) { rows.delete(r); continue; }
      for (const node of row.children) style(node, { size: r === 1 ? 12 : r === 7 ? 12 : 8 });
    }
    const metadataLines = Math.max(1, Math.ceil(String(section.subject || '').length / 75), Math.ceil(String(metadata.teacherName || '').length / 75), Math.ceil([period.name,section.level,section.section].join(' ').length/48));
    const headerHeights = [17,10,10,10,10,2,14,2,2,12,2,2,metadataLines * 10 + 3,13,14,28,28,14];
    headerHeights.forEach((points, i) => height(i + 1, points));
    for (let r = 14; r <= lastLearnerRow; r++) {
      for (let c = 0; c <= lastCol; c++) style(cell(c, r), { size: r <= 18 ? 7 : 8, grid: true });
      if (r >= 19) {
        const name = String(period.roster[r - 19]?.name || '');
        const descriptor = cell(lastCol,r).getElementsByTagNameNS(NS,'v')[0]?.textContent || '';
        const lines = Math.max(Math.ceil(descriptor.length/17),name.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 25)), 0));
        height(r, Math.max(10, lines * 9 + 1));
      }
    }
    for (const kind of ['ww', 'pt']) for (const c of rawColumns[kind]) style(cell(c, 17), { size: 8, grid: true, wrap: false, rotate: 90 });
    // Short dates fit vertically; the register carries the complete calendar date.
    rawColumns.qa.forEach((c, i) => {
      const role = period.activityMeta?.qa?.[i]?.role || root.CSTRGrading.defaultRole('qa', i, section.gradingCategory || section.subject);
      const date = String(period.qaDates[i] || '').replace(/^\d{4}-(\d{2})-(\d{2})$/, '$1/$2');
      const label = { st1: 'Long quiz / Unit test', st2: 'Monthly exam', te: payload.calendarMode === 'trimester' ? 'Term exam' : 'Quarterly exam' }[role] || '';
      write(c, 15, [section.weights[2] ? roleLabel(role) : 'Not counted', date, label].filter(Boolean).join('\n'));
      style(cell(c, 15), { size: 7, grid: true });
    });
    const merges = sheet.getElementsByTagNameNS(NS, 'mergeCells')[0];
    const kept = [...merges.children].filter(n => address(n.getAttribute('ref').split(':')[0]).r < mapRow(70));
    merges.replaceChildren(...kept); merges.setAttribute('count', kept.length);
    // Metadata labels originally occupied individual narrow score columns.
    // Give them their own merged lanes, leaving the school's score table intact.
    for (const r of [10,11,13]) {
      for (const node of [...merges.children]) if (address(node.getAttribute('ref').split(':')[0]).r === r) node.remove();
      for (let c = 0; c <= lastCol; c++) { write(c, r, ''); style(cell(c,r), { clearBorder: true }); }
    }
    const metadataLane = (r, start, end, value) => {
      write(mapCol(start), r, value); style(cell(mapCol(start), r), { size: 8, clearBorder: true });
      merges.appendChild(el(doc, 'mergeCell', { ref: `${col(mapCol(start))}${r}:${col(mapCol(end))}${r}` }));
    };
    metadataLane(10,0,10,'REGION VI · DIVISION OF SAN CARLOS');
    metadataLane(10,11,23,'SCHOOL: COLEGIO DE STO. TOMAS-RECOLETOS, INC.');
    metadataLane(10,24,34,`SCHOOL ID: 404207 · SCHOOL YEAR: ${metadata.schoolYear || ''}`);
    metadataLane(13,0,6,`${period.name || ''} · ${section.level || ''} - ${section.section || ''}`);
    metadataLane(13,7,23,`TEACHER: ${String(metadata.teacherName || '').replace(/\s+/gu,' ')}`);
    metadataLane(13,24,34,`SUBJECT: ${section.subject || ''}`);
    merges.setAttribute('count',merges.children.length);
    // Signatories occupy the bottom of the final grade page, including short classes.
    const nameLines = Math.max(1, ...['teacherName','checkerName','reviewerName','principalName'].map(k => Math.ceil(String(metadata[k] || '').length / 48)));
    const signatureHeights = [0, 4, 11, 16, Math.max(12, nameLines * 10 + 2), 12];
    signatureHeights.forEach((points, i) => height(mapRow(64 + i), points));
    for (const r of [66,68,69]) for (const node of rows.get(mapRow(r)).children) style(node, { size: 8 });
    const printableHeight = 8.5 * 72 - .6 * 72;
    const headerHeight = sumNumbers(headerHeights), signatureHeight = sumNumbers(signatureHeights);
    const bodyBudget = printableHeight - headerHeight - signatureHeight - 4;
    const continuationBudget = printableHeight - headerHeight - 4;
    let pageHeight = 0;
    const breaks = [];
    const visibleRows = [...rows.keys()].filter(r=>r>=19&&r<=lastLearnerRow&&rows.get(r).getAttribute('hidden')!=='1');
    let remainingHeight = sumNumbers(visibleRows.map(r=>Number(rows.get(r).getAttribute('ht'))));
    for (const [index,r] of visibleRows.entries()) {
      const row = rows.get(r);
      const rowHeight = Number(row.getAttribute('ht'));
      const finalPage = pageHeight + remainingHeight <= bodyBudget;
      const remainingRows = visibleRows.length - index;
      // Keep a useful final group with its signatures rather than an orphan row.
      const leaveFinalGroup = !finalPage && remainingRows <= 6 && remainingHeight <= bodyBudget;
      if (pageHeight && (pageHeight + rowHeight > continuationBudget || leaveFinalGroup)) { breaks.push(r - 1); pageHeight = 0; }
      pageHeight += rowHeight;
      remainingHeight -= rowHeight;
    }
    height(mapRow(64), Math.max(4, printableHeight - headerHeight - signatureHeight - pageHeight - 4));
    for (const node of sheet.querySelectorAll('printOptions,rowBreaks,colBreaks,headerFooter')) node.remove();
    const margins = sheet.getElementsByTagNameNS(NS, 'pageMargins')[0], setup = sheet.getElementsByTagNameNS(NS, 'pageSetup')[0];
    sheet.insertBefore(el(doc, 'printOptions', { horizontalCentered: 0, verticalCentered: 0, gridLines: 0, headings: 0 }), margins);
    for (const [key, value] of Object.entries({ left: .25, right: .25, top: .3, bottom: .3, header: .1, footer: .1 })) margins.setAttribute(key, value);
    for (const attr of ['fitToWidth','fitToHeight']) setup.removeAttribute(attr);
    for (const [key, value] of Object.entries({ paperSize: 14, orientation: 'landscape', scale: 100 })) setup.setAttribute(key, value);
    const printPr = sheet.getElementsByTagNameNS(NS, 'pageSetUpPr')[0];
    printPr.setAttribute('fitToPage', '0'); printPr.setAttribute('autoPageBreaks', '0');
    const footer = el(doc, 'headerFooter');
    const oddFooter = el(doc, 'oddFooter'); oddFooter.textContent = '&R&"Arial"&8Page &P of &N'; footer.appendChild(oddFooter); setup.after(footer);
    const rowBreaks = el(doc, 'rowBreaks', { count: breaks.length, manualBreakCount: breaks.length });
    for (const id of breaks) rowBreaks.appendChild(el(doc, 'brk', { id, min: 0, max: 16383, man: 1 }));
    footer.after(rowBreaks);
    const columnBreaks = [];
    let bandWidth = 0;
    for (let c = 0; c <= lastCol; c++) {
      if (bandWidth + widths.get(c) > 899 && c > 2) { columnBreaks.push(c); bandWidth = 124; }
      bandWidth += widths.get(c);
    }
    const colBreaks = el(doc, 'colBreaks', { count: columnBreaks.length, manualBreakCount: columnBreaks.length });
    for (const id of columnBreaks) colBreaks.appendChild(el(doc, 'brk', { id, min: 0, max: 1048575, man: 1 }));
    rowBreaks.after(colBreaks);
    sheet.getElementsByTagNameNS(NS, 'dimension')[0].setAttribute('ref', `A1:${col(lastCol)}${roleRow}`);
    // Keep the logo at a fixed physical size after narrowing the native columns.
    const drawing = parse(await zip.file('xl/drawings/drawing1.xml').async('string'));
    const dns = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
    for (const anchor of [...drawing.documentElement.children]) {
      const picture = anchor.getElementsByTagNameNS(dns, 'pic')[0]; if (!picture) continue;
      const fixed = drawing.createElementNS(dns, 'xdr:absoluteAnchor');
      const pos = drawing.createElementNS(dns, 'xdr:pos'); pos.setAttribute('x', 35 * 12700); pos.setAttribute('y', 3 * 12700);
      const ext = drawing.createElementNS(dns, 'xdr:ext'); ext.setAttribute('cx', 48 * 12700); ext.setAttribute('cy', 42 * 12700);
      fixed.append(pos, ext, picture, drawing.createElementNS(dns, 'xdr:clientData')); anchor.replaceWith(fixed);
    }
    zip.file('xl/drawings/drawing1.xml', serialize(drawing));

    // A separate print sheet prevents roster print titles and score widths from
    // leaking onto the register. Every activity retains its full date and HPS.
    const activityDoc = parse(`<worksheet xmlns="${NS}"/>`), activitySheet = activityDoc.documentElement;
    const pr = el(activityDoc, 'sheetPr'); pr.appendChild(el(activityDoc, 'pageSetUpPr', { fitToPage: 0 })); activitySheet.appendChild(pr);
    const entries = Object.entries(register).flatMap(([kind, list]) => list.map(entry => ({ kind, ...entry })));
    activitySheet.appendChild(el(activityDoc, 'dimension', { ref: `A1:G${Math.max(6, entries.length + 5)}` }));
    const views = el(activityDoc, 'sheetViews'), view = el(activityDoc, 'sheetView', { workbookViewId: 0 });
    view.appendChild(el(activityDoc, 'pane', { ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' })); views.appendChild(view); activitySheet.appendChild(views);
    activitySheet.appendChild(el(activityDoc, 'sheetFormatPr', { defaultRowHeight: 24 }));
    const activityWidths = [55,80,210,240,190,72,51];
    const activityCols = el(activityDoc, 'cols'); activityWidths.forEach((points, i) => activityCols.appendChild(el(activityDoc, 'col', { min: i + 1, max: i + 1, width: (points / 5.65).toFixed(5), customWidth: 1 }))); activitySheet.appendChild(activityCols);
    const data = el(activityDoc, 'sheetData'); activitySheet.appendChild(data);
    function activityRow(r, values, points, grid = false, size = 9, dateIndex = -1) {
      const row = el(activityDoc, 'row', { r, ht: points, customHeight: 1 }); data.appendChild(row);
      values.forEach((value, c) => {
        const node = el(activityDoc, 'c', { r: `${col(c)}${r}` });
        const source = cell(mapCol(c === dateIndex ? 2 : 4), mapRow(76));
        node.setAttribute('s', source.getAttribute('s') || '0'); style(node, { size, grid, bold: r === 1 || r === 5 });
        const dateTime = c === dateIndex ? Date.parse(value + 'T00:00:00Z') : NaN;
        if (c === dateIndex && /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Number.isFinite(dateTime) && new Date(dateTime).toISOString().slice(0,10) === value) {
          const v = el(activityDoc, 'v'); v.textContent = (Date.parse(value + 'T00:00:00Z') - Date.UTC(1899,11,30)) / 86400000; node.appendChild(v);
          // Reuse the numeric date style generated for the old summary date.
          const xf = xfs.children[Number(node.getAttribute('s'))].cloneNode(true);
          const numFmts = stylesDoc.getElementsByTagNameNS(NS,'numFmts')[0];
          let fmt = [...numFmts.children].find(n => n.getAttribute('formatCode') === 'mm/dd/yyyy');
          if (!fmt) { fmt=el(stylesDoc,'numFmt',{numFmtId:Math.max(163,...[...numFmts.children].map(n=>Number(n.getAttribute('numFmtId'))))+1,formatCode:'mm/dd/yyyy'});numFmts.appendChild(fmt);numFmts.setAttribute('count',numFmts.children.length); }
          xf.setAttribute('numFmtId', fmt.getAttribute('numFmtId')); xf.setAttribute('applyNumberFormat', '1'); node.setAttribute('s', xfs.children.length); xfs.appendChild(xf);
        } else if (typeof value === 'number' && Number.isFinite(value)) { const v = el(activityDoc, 'v'); v.textContent = value; node.appendChild(v); }
        else { node.setAttribute('t', 'inlineStr'); const inline = el(activityDoc, 'is'), text = el(activityDoc, 't'); text.setAttribute('xml:space', 'preserve'); text.textContent = value == null ? '' : String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); inline.appendChild(text); node.appendChild(inline); }
        row.appendChild(node);
      });
    }
    activityRow(1, ['Activity register'], 22, false, 12);
    activityRow(2, [section.subject || ''], 20);
    activityRow(3, [[period.name, section.level, section.section, metadata.schoolYear].filter(Boolean).join(' · ')], 20);
    activityRow(4, [metadata.teacherName || ''], 20);
    activityRow(5, ['Component','Score column','Activity title / Assessment group','Learning competency','Topic','Date','HPS'], 25, true);
    const registerBreaks = []; let registerHeight = 107;
    entries.forEach((entry, i) => {
      const values = [entry.kind.toUpperCase(), entry.column, entry.title, entry.competency, entry.topicOnly, entry.date, root.CSTRGrading.numberOrNull(entry.hps) ?? ''];
      const lineCount = Math.max(1, ...values.map((v,c) => String(v || '').split('\n').reduce((n,line) => n + Math.max(1, Math.ceil(line.length / Math.max(5, Math.floor(activityWidths[c] / 4.8)))), 0)));
      const points = Math.min(409, Math.max(25, lineCount * 11 + 5));
      if (registerHeight + points > printableHeight - 4) { registerBreaks.push(i + 5); registerHeight = 107; }
      activityRow(i + 6, values, points, true, 9, 5); registerHeight += points;
    });
    if (!entries.length) activityRow(6, ['No recorded activities.','','','','','',''], 25, true);
    const activityMerges = el(activityDoc, 'mergeCells', { count: 4 });
    for (const r of [1,2,3,4]) activityMerges.appendChild(el(activityDoc, 'mergeCell', { ref: `A${r}:G${r}` })); activitySheet.appendChild(activityMerges);
    for (const tag of ['printOptions','pageMargins','pageSetup','headerFooter']) activitySheet.appendChild(sheet.getElementsByTagNameNS(NS, tag)[0].cloneNode(true));
    const activityBreaks = el(activityDoc, 'rowBreaks', { count: registerBreaks.length, manualBreakCount: registerBreaks.length });
    for (const id of registerBreaks) activityBreaks.appendChild(el(activityDoc, 'brk', { id, min: 0, max: 16383, man: 1 })); activitySheet.appendChild(activityBreaks);
    zip.file('xl/worksheets/sheet2.xml', serialize(activityDoc));
    fonts.setAttribute('count', fonts.children.length);
    return { endRow: mapRow(69), registerEndRow: Math.max(6, entries.length + 5), style };
  }

  // One contiguous range per component, with a hidden row for assessment roles.
  // Formula length is independent of how often the roles alternate.
  function groupTerms(columns, row, roleRow, role) {
    const first = col(columns[0]), last = col(columns[columns.length - 1]);
    const scores = `${first}${row}:${last}${row}`, hps = `${first}$18:${last}$18`;
    const roles = `${first}$${roleRow}:${last}$${roleRow}`;
    const mask = role ? `--(${roles}="${role}"),` : '';
    return {
      configured: `SUMPRODUCT(${mask}${hps})`,
      denominator: `SUMPRODUCT(${mask}--(${scores}<>"E"),--(${scores}<>"L"),${hps})`,
      numerator: `SUMPRODUCT(${mask}${scores})`,
      pending: `SUMPRODUCT(--(${hps}>0),--(${scores}=""))`,
      unassigned: `SUMPRODUCT(--(${roles}=""),--(((${hps}<>"")+(${scores}<>""))>0))`,
      invalid: `COLUMNS(${scores})-COUNT(${scores})-COUNTBLANK(${scores})-COUNTIF(${scores},"A")-COUNTIF(${scores},"M")-COUNTIF(${scores},"E")-COUNTIF(${scores},"L")+COLUMNS(${hps})-COUNT(${hps})-COUNTBLANK(${hps})+SUMPRODUCT(--ISNUMBER(${hps}),--(${hps}<=0))+SUMPRODUCT(--ISNUMBER(${scores}),--(${scores}<0))+SUMPRODUCT(--ISNUMBER(${scores}),--(${scores}>${hps}))+SUMPRODUCT(--(${scores}<>""),--(${hps}=""))`
    };
  }

  async function build(payload, options = {}) {
    if (!root.JSZip || !root.CSTRGrading) throw new Error('School Excel export tools are unavailable.');
    validate(payload);
    const { section, period } = payload, metadata = payload.metadata || {};
    const input = options.templateBytes || await (async () => {
      const response = await fetch(new URL('ASSETS/templates/cstr-class-record.xlsx?v=20261025', document.baseURI));
      if (!response.ok) throw new Error('The school Excel template could not be loaded. Refresh and retry.');
      return response.arrayBuffer();
    })();
    const zip = await root.JSZip.loadAsync(input);
    const doc = parse(await zip.file('xl/worksheets/sheet1.xml').async('string'));
    const sheet = doc.documentElement, sheetData = sheet.getElementsByTagNameNS(NS, 'sheetData')[0];
    const original = options.preserveInputs === true;
    const signatures = [
      ['B', 'I', 'B', 'Submitted by:', metadata.teacherName, 'Subject Teacher'],
      ['K', 'S', 'C', 'Checked by:', metadata.checkerName, 'Subject Area Coordinator'],
      ['U', 'AB', 'O', 'Reviewed by:', metadata.reviewerName, section.group === 'SHS' ? 'SHS Coordinator' : 'JHS Coordinator'],
      ['AD', 'AI', 'Y', 'Noted by:', metadata.principalName, 'Principal']
    ];
    const lengths = { ww: period.wwHps.length, pt: period.ptHps.length, qa: period.qaHps.length };
    const added = { ww: Math.max(0, lengths.ww - 10), pt: Math.max(0, lengths.pt - 8), qa: Math.max(0, lengths.qa - 3) };
    const mapCol = c => c + (c >= 12 ? added.ww : 0) + (c >= 22 ? added.pt : 0) + (c >= 27 ? added.qa : 0);
    const extraRows = Math.max(0, period.roster.length - 45), mapRow = r => r + (r >= 64 ? extraRows : 0);
    const mapRef = ref => ref.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (_, ac, c, ar, r) => `${ac}${col(mapCol(colIndex(c)))}${ar}${mapRow(Number(r))}`);
    const lastLearnerRow = 63 + extraRows, lastCol = mapCol(34);
    // Remove the source file's unused formatting-only tail before cloning.
    for(const row of [...sheetData.children])if(Number(row.getAttribute('r'))>82)row.remove();
    const baseRows = new Map([...sheetData.children].map(row => [Number(row.getAttribute('r')), row.cloneNode(true)]));
    const oldMerges = [...sheet.getElementsByTagNameNS(NS, 'mergeCell')].map(node => node.getAttribute('ref'));
    const originalStyles = new Map([...sheet.getElementsByTagNameNS(NS, 'c')].map(c => [c.getAttribute('r'), c.getAttribute('s')]));
    // Map all native cell positions and view/range properties before adding data.
    for (const row of [...sheetData.children]) {
      const oldRow = Number(row.getAttribute('r'));
      if (oldRow > 82) { row.remove(); continue; }
      row.setAttribute('r', mapRow(oldRow)); row.removeAttribute('spans');
      for (const c of [...row.children]) c.setAttribute('r', mapRef(c.getAttribute('r')));
    }
    for (const node of sheet.querySelectorAll('[ref],[sqref],[activeCell],[topLeftCell]')) {
      for (const attr of ['ref', 'sqref', 'activeCell', 'topLeftCell']) if (node.hasAttribute(attr)) node.setAttribute(attr, mapRef(node.getAttribute(attr)));
    }
    const rows = new Map([...sheetData.children].map(row => [Number(row.getAttribute('r')), row]));
    let cells;
    function ensureRow(r, sourceRow) {
      if (rows.has(r)) return rows.get(r);
      const node = sourceRow ? baseRows.get(sourceRow).cloneNode(true) : el(doc, 'row');
      node.setAttribute('r', r); node.removeAttribute('hidden'); node.removeAttribute('spans');
      for (const c of [...node.children]) {
        const originalAddress = address(c.getAttribute('r'));
        c.setAttribute('r', `${col(mapCol(originalAddress.c))}${r}`);
        [...c.children].forEach(n => n.remove()); c.removeAttribute('t');
      }
      rows.set(r, node);
      if(cells) for(const c of [...node.children]) cells.set(c.getAttribute('r'),c);
      return node;
    }
    for (let r = 64; r <= lastLearnerRow; r++) ensureRow(r, 57);
    cells = new Map([...rows.values()].flatMap(row => [...row.children].map(c => [c.getAttribute('r'), c])));
    function cell(c, r, style) {
      const key = `${col(c)}${r}`;
      if (!cells.has(key)) {
        const node = el(doc, 'c', { r: key }); if (style !== undefined && style !== null) node.setAttribute('s', style);
        ensureRow(r).appendChild(node); cells.set(key, node);
      }
      return cells.get(key);
    }
    function write(c, r, value, formula) {
      const node = cell(c, r);
      [...node.children].forEach(n => n.remove()); node.removeAttribute('t');
      if (formula !== undefined) {
        const f = el(doc, 'f'); f.textContent = formula; node.appendChild(f);
        const v = el(doc, 'v');
        if (typeof value !== 'number' || !Number.isFinite(value)) { node.setAttribute('t', 'str'); v.textContent = value == null ? '' : String(value); }
        else v.textContent = String(value);
        node.appendChild(v);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        const v = el(doc, 'v'); v.textContent = String(value); node.appendChild(v);
      } else if (present(value)) {
        node.setAttribute('t', 'inlineStr'); const inline = el(doc, 'is'), t = el(doc, 't');
        t.setAttribute('xml:space', 'preserve'); t.textContent = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); inline.appendChild(t); node.appendChild(inline);
      }
    }
    const W = (oldCol, oldRow, value, formula) => write(mapCol(colIndex(oldCol)), mapRow(oldRow), value, formula);
    const rawColumns = { ww: Array.from({ length: Math.max(10, lengths.ww) }, (_, i) => 2 + i), pt: Array.from({ length: Math.max(8, lengths.pt) }, (_, i) => mapCol(14) + i), qa: Array.from({ length: Math.max(3, lengths.qa) }, (_, i) => mapCol(24) + i) };
    const roleRow = mapRow(76) + Math.max(7, ...Object.values(lengths));
    ensureRow(roleRow).setAttribute('hidden', '1');
    const componentRules = Object.fromEntries(Object.keys(rawColumns).map(kind => [kind, root.CSTRGrading.componentOptions(section, period, kind)]));
    for (const [kind, columns] of Object.entries(rawColumns)) {
      const { groups, roles } = componentRules[kind];
      if (!groups) continue;
      columns.forEach((c, index) => write(c, roleRow, groups.some(group => group.id === roles[index]) ? roles[index] : ''));
    }
    // New score columns inherit the corresponding native raw-score style.
    for (const [kind, columns] of Object.entries(rawColumns)) {
      const sourceCol = { ww: 'K', pt: 'V', qa: 'AA' }[kind];
      for (let r = 14; r <= lastLearnerRow; r++) {
        const sourceR = Math.min(r, 57);
        for (const c of columns) cell(c, r, originalStyles.get(`${sourceCol}${sourceR}`) || originalStyles.get(`${sourceCol}19`));
      }
    }
    const stylesDoc=parse(await zip.file('xl/styles.xml').async('string'));
    const fonts = stylesDoc.getElementsByTagNameNS(NS, 'fonts')[0];
    // The template shares its score fonts across populated, blank and inserted cells.
    for (const font of fonts.children) {
      const color = font.getElementsByTagNameNS(NS, 'color')[0];
      const black = el(stylesDoc, 'color', { rgb: 'FF000000' });
      if (color) color.replaceWith(black);
      else font.appendChild(black);
    }
    const cellXfs=stylesDoc.getElementsByTagNameNS(NS,'cellXfs')[0],numberStyles=new Map();
    let numFmts=stylesDoc.getElementsByTagNameNS(NS,'numFmts')[0];
    if(!numFmts){numFmts=el(stylesDoc,'numFmts',{count:0});stylesDoc.documentElement.insertBefore(numFmts,stylesDoc.documentElement.firstChild);}
    function formatNumber(node, format) {
      const base = Number(node.getAttribute('s') || 0), key = base + '|' + format;
      if (!numberStyles.has(key)) {
        let numFmtId = 0; // General keeps the raw score's decimals visible.
        if (format !== 'General') {
          let numFmt = [...numFmts.children].find(n => n.getAttribute('formatCode') === format);
          if (!numFmt) {
            const nextId = Math.max(163, ...[...numFmts.children].map(n => Number(n.getAttribute('numFmtId')))) + 1;
            numFmt = el(stylesDoc, 'numFmt', { numFmtId: nextId, formatCode: format });
            numFmts.appendChild(numFmt);
            numFmts.setAttribute('count', numFmts.children.length);
          }
          numFmtId = numFmt.getAttribute('numFmtId');
        }
        const clone = cellXfs.children[base].cloneNode(true);
        clone.setAttribute('numFmtId', numFmtId);
        clone.setAttribute('applyNumberFormat', '1');
        numberStyles.set(key, cellXfs.children.length);
        cellXfs.appendChild(clone);
      }
      node.setAttribute('s', numberStyles.get(key));
    }
    function writeDate(c,r,value,format){
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
      if(!match){write(c,r,value);return;}
      const time=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]));
      if(new Date(time).toISOString().slice(0,10)!==value){write(c,r,value);return;}
      write(c,r,(time-Date.UTC(1899,11,30))/86400000);
      formatNumber(cell(c,r), format);
    }
    const rowHasData = learner => present(learner?.name) || ['ww','pt','qa'].some(k => (learner?.[k] || []).some(present));
    const lastUsedIndex = period.roster.reduce((last, learner, index) => rowHasData(learner) ? index : last, -1);
    const learnerStyleColumns = new Map(Array.from({ length: 35 }, (_, c) => [mapCol(c), col(c)]));
    for (const [kind, source] of [['ww', 'K'], ['pt', 'U'], ['qa', 'AA']]) {
      for (const c of rawColumns[kind]) if (!learnerStyleColumns.has(c)) learnerStyleColumns.set(c, source);
    }
    for (let r = 19; r <= lastLearnerRow; r++) {
      const row = ensureRow(r);
      if (r - 19 <= lastUsedIndex) row.removeAttribute('hidden');
      else if (!original) row.setAttribute('hidden', '1');
      if (!original) {
        row.setAttribute('ht', '15');
        row.setAttribute('customHeight', '1');
        // Use the same native body style through the roster, including added rows.
        for (const [c, source] of learnerStyleColumns) {
          write(c, r, '');
          const node = cell(c, r);
          node.setAttribute('s', originalStyles.get(`${source}20`) || '0');
        }
        rawColumns.qa.forEach(c => formatNumber(cell(c, r), 'General'));
        formatNumber(cell(mapCol(29), r), '0.00'); // Match the other exam WS columns.
        formatNumber(cell(mapCol(30), r), '0.000');
        formatNumber(cell(mapCol(32), r), '0.000');
      }
    }
    if (!original) {
      W('AG', 11, metadata.schoolYear || '');
      W('A', 13, period.name || ''); W('H', 13, `${section.level || ''}${section.section ? ' - ' + section.section : ''}`);
      W('O', 13, metadata.teacherName || ''); W('AG', 13, section.subject || '');
      let number = 0;
      period.roster.forEach((learner, index) => {
        const r = 19 + index, category = root.CSTRRecordTools?.getRowCategory(learner);
        write(0, r, present(learner.name) && !category ? ++number : ''); write(1, r, learner.name || '');
        if (category) return;
        for (const kind of ['ww','pt','qa']) learner[kind].forEach((value, i) => write(rawColumns[kind][i], r, root.CSTRGrading.isAttendanceCode(value) ? String(value).trim().toUpperCase() : root.CSTRGrading.numberOrNull(value) ?? (present(value) ? value : '')));
      });
    }
    const weights = section.weights;
    const examRoles = ['st1', 'st2', 'te'];
    const examShares = examRoles.map(role => weights[2] === 0 ? 0 : componentRules.qa.groups.find(group => group.id === role)?.share || 0);
    const examTitle = payload.calendarMode === 'trimester' ? 'TERM ASSESSMENT' : 'QUARTERLY ASSESSMENT';
    const weightCells = ['N', 'X', 'AF'];
    const percentText = ref => `ROUND(${ref}*100,12)&"%"`;
    const componentHeaders = [
      ['ww', 'C', 'WRITTEN WORKS', 'Activities/Exercises'],
      ['pt', 'O', 'PERFORMANCE TASK', 'Performance Check/Performance Tasks'],
      ['qa', 'Y', examTitle]
    ];
    componentHeaders.forEach(([kind, c, title, subtitle], i) => {
      const ref = `${col(mapCol(colIndex(weightCells[i])))}$18`;
      W(c, 14, `${title} (${weights[i]}%)`, `"${title} ("&${percentText(ref)}&")"`);
      if (subtitle) {
        const groups = weights[i] > 0 ? componentRules[kind].groups : null;
        const groupText = groups ? `Grade shares (${groups.map(({id, share}) => `${roleLabel(id)} ${weights[i] * share}%`).join(' / ')})` : '';
        W(c, 15, [subtitle, `${weights[i]}%`, groupText].filter(Boolean).join('\n'),
          `"${subtitle}"&CHAR(10)&${percentText(ref)}${groupText ? `&CHAR(10)&"${groupText}"` : ''}`);
      }
      W(weightCells[i], 18, weights[i] / 100);
      if (!Number.isInteger(weights[i])) {
        const [coefficient, exponent = '0'] = String(weights[i]).split('e');
        const decimals = Math.min(12, (coefficient.split('.')[1]?.length || 0) - Number(exponent));
        formatNumber(cell(mapCol(colIndex(weightCells[i])), 18), `0.${'0'.repeat(decimals)}%`);
      }
    });
    W('AH', 14, section.gradingMode === 'zero-based' ? 'REPORTED GRADE' : 'TRANSMUTED GRADE');
    const examWeightCells = ['AB', 'AC', 'AD'];
    examWeightCells.forEach((c, i) => {
      W(c, 18, examShares[i]);
      W(c, 15, `WS ${roleLabel(examRoles[i])}\n(${examShares[i] * 100}%)`);
    });
    W('AE', 18, weights[2] === 0 ? '' : 100);
    for (const kind of ['ww','pt','qa']) {
      rawColumns[kind].forEach((c, index) => {
        const value = period[kind + 'Hps'][index];
        if (!original) write(c,18,root.CSTRGrading.numberOrNull(value) ?? '');
        if (kind !== 'qa') { if (!original) writeDate(c,17,period[kind + 'Dates'][index] || '', 'm/d'); }
        else {
          const role = componentRules.qa.roles[index];
          const labels = {st1:'Long Quiz / Unit Test / Chapter Test',st2:'Monthly Exam',te:payload.calendarMode==='trimester'?'Term Exam':'Quarterly Exam'};
          write(c,15,[weights[2] ? roleLabel(role) || `EX ${index+1}` : 'Not counted', period.qaDates[index] || '', weights[2] && labels[role]].filter(Boolean).join('\n'));
        }
      });
    }
    const totalCols = { ww: mapCol(12), pt: mapCol(22) }, wsCols = { ww: mapCol(13), pt: mapCol(23), qa: mapCol(31) };
    for (const kind of ['ww','pt']) {
      const columns = rawColumns[kind], hpsTotal = `SUM(${col(columns[0])}18:${col(columns.at(-1))}18)`;
      write(totalCols[kind],18, sumNumbers(period[kind+'Hps'].map(x => root.CSTRGrading.numberOrNull(x)||0)),hpsTotal);
    }
    const preset=root.CSTRGrading.SUBJECT_PRESETS.find(item=>item.name===(section.gradingCategory||section.subject));
    const fixedWeights = preset ? weightCells.map((c, i) => [c, preset.weights[i] / 100]) : [];
    fixedWeights.push(...examWeightCells.map((c, i) => [c, examShares[i]]));
    const subjectWeightGuard=fixedWeights.map(([c,value])=>`ABS(${col(mapCol(colIndex(c)))}$18-${value})>0.0000000001`);
    const comparisonGrade = ref => `ROUND(${ref},${root.CSTRGrading.GRADE_COMPARISON_DECIMALS})`;
    const tierFormula = ref => root.CSTRGrading.TRANSMUTATION_TABLE.slice(0,-1).reduceRight((tail,tier) => `IF(${comparisonGrade(ref)}>=${tier.min},${tier.grade},${tail})`,'60');
    const resultCells = [];
    let learnerNumber = 0;
    for (let r = 19; r <= lastLearnerRow; r++) {
      const learner = period.roster[r-19] || { name:'', ww:[],pt:[],qa:[] };
      const category = root.CSTRRecordTools?.getRowCategory(learner);
      if (category) continue;
      const result = root.CSTRGrading.calculateLearner(learner,period,section), named = present(learner.name);
      const setFormula = (c,f,v) => { if(f.length>8192)throw new Error('Excel formula length exceeded. Keep activities from the same assessment group adjacent, or reduce the number of columns.'); write(c,r,named ? v : '',f); resultCells.push(`${col(c)}${r}`); };
      const terms = Object.fromEntries(Object.entries(rawColumns).map(([kind, columns]) => [kind, groupTerms(columns, r, roleRow)]));
      if(!original){
        if (named) learnerNumber++;
        const numbering = r === 19 ? '1' : `COUNT($A$19:$A${r - 1})+1`;
        setFormula(0,`IF($B${r}="","",${numbering})`,learnerNumber);
      }
      for (const kind of ['ww','pt']) {
        const columns = rawColumns[kind], t = terms[kind], component = result[kind];
        const ws = `${col(wsCols[kind])}$18`, total = `${col(totalCols[kind])}${r}`;
        setFormula(totalCols[kind], `IF($B${r}="","",IF(${ws}=0,0,${t.numerator}))`, component.rawTotal);
        const { groups } = componentRules[kind];
        let weighted = `IF(${t.denominator}=0,"",${total}/${t.denominator}*100*${ws})`;
        if (groups) {
          const grouped = groups.map(g => ({ ...g, ...groupTerms(columns, r, roleRow, g.id) }));
          const activeShare = sum(grouped.map(g => `IF(${g.denominator}>0,${g.share},0)`));
          const ready = grouped.map(g => `${g.configured}>0`).join(',');
          const percentages = sum(grouped.map(g => `IF(${g.denominator}>0,${g.numerator}/${g.denominator}*100*${g.share},0)`));
          weighted = `IF(AND(${ready},${activeShare}>0),${percentages}/${activeShare}*${ws},"")`;
        }
        const invalid = groups ? `(${t.invalid})+${t.unassigned}` : t.invalid;
        setFormula(wsCols[kind],`IF($B${r}="","",IF(${ws}=0,0,IF(${invalid}>0,NA(),${weighted})))`,component.weighted);
      }
      const qaGroups=componentRules.qa.groups.map(({id: role})=>({role,...groupTerms(rawColumns.qa,r,roleRow,role)}));
      const qaCellRefs=[];
      for(const [i,role] of examRoles.entries()) {
        const c=mapCol(27+i),g=qaGroups.find(g=>g.role===role),weight=`${col(c)}$18`,ref=`${col(c)}${r}`;
        qaCellRefs.push(ref);
        let cache='';
        if(g&&weights[2]>0){const item=result.qa.groups?.find(g=>g.id===role);if(item?.percentage!=null)cache=item.percentage*examShares[i];}
        setFormula(c,`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,"",${g?`IF(${g.denominator}=0,"",${g.numerator}/${g.denominator}*100*${weight})`:'""'}))`,cache);
      }
      const activeShare=sum(qaCellRefs.map((ref,i)=>`IF(ISNUMBER(${ref}),${col(mapCol(27+i))}$18,0)`));
      const qaReady=qaGroups.map(g=>`${g.configured}>0`).join(',');
      const qaPS=`IF(AND(${qaReady||'FALSE'}),IF(${activeShare}=0,"",SUM(${qaCellRefs.join(',')})/${activeShare}),"")`;
      setFormula(mapCol(30),`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,"",IF((${terms.qa.invalid})+${terms.qa.unassigned}>0,NA(),${qaPS})))`,result.qa.percentage);
      const examPS = `${col(mapCol(30))}${r}`;
      setFormula(wsCols.qa,`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,0,IF(${examPS}="","",${examPS}*${col(wsCols.qa)}$18)))`,result.qa.weighted);
      const wsRefs=Object.values(wsCols).map(c=>`${col(c)}${r}`), ig=`${col(mapCol(32))}${r}`, grade=`${col(mapCol(33))}${r}`;
      const weightRefs = Object.values(wsCols).map(c => `${col(c)}$18`).join(',');
      const invalidWeights = [`COUNT(${weightRefs})<>3`, `MIN(${weightRefs})<0`, `MAX(${weightRefs})>1`, `ABS(SUM(${weightRefs})-1)>0.0000000001`, ...subjectWeightGuard];
      setFormula(mapCol(32),`IF($B${r}="","",IF(OR(${invalidWeights.join(',')},${wsRefs.map(ref => `ISERROR(${ref})`).join(',')}),NA(),IF(COUNT(${wsRefs.join(',')})=3,SUM(${wsRefs.join(',')}),"")))`,result.initial.precise);
      setFormula(mapCol(33),`IF(ISNUMBER(${ig}),${section.gradingMode==='zero-based'?`MAX(${root.CSTRGrading.MINIMUM_REPORTED_GRADE},ROUND(${comparisonGrade(ig)},0))`:tierFormula(ig)},"")`,result.initial.transmuted);
      const pending = sum(Object.keys(terms).map(kind => `IF(${col(wsCols[kind])}$18=0,0,${terms[kind].pending})`));
      const hasPending = ['ww','pt','qa'].some(kind => result[kind].missing > 0);
      const descriptor = `IF(${grade}>=90,"Advancing",IF(${grade}>=80,"Benchmarking",IF(${grade}>=75,"Connecting",IF(${grade}>=65,"Developing","Emerging"))))`;
      setFormula(mapCol(34),`IF($B${r}="","",IF(ISERROR(${ig}),"Check inputs",IF(ISNUMBER(${grade}),${descriptor}&IF(${pending}>0," (pending)",""),"Incomplete")))`,result.initial.transmuted === null ? 'Incomplete' : result.initial.descriptor + (hasPending ? ' (pending)' : ''));
    }
    // Append alignment variants without changing the template's style IDs.
    const alignmentStyles=new Map();
    function fitCell(c,r,wrap = true) {
      const node=cell(c,r),baseStyle=Number(node.getAttribute('s')||0),key=`${baseStyle}:${wrap}`;
      if(!alignmentStyles.has(key)){
        const clone=cellXfs.children[baseStyle].cloneNode(true);let alignment=clone.getElementsByTagNameNS(NS,'alignment')[0];
        if(!alignment){alignment=el(stylesDoc,'alignment');clone.insertBefore(alignment,clone.firstChild);}
        alignment.setAttribute('wrapText',wrap ? '1' : '0');
        alignment.setAttribute('shrinkToFit',wrap ? '0' : '1');
        clone.setAttribute('applyAlignment','1');
        alignmentStyles.set(key,cellXfs.children.length);cellXfs.appendChild(clone);
      }
      node.setAttribute('s',alignmentStyles.get(key));
    }
    weightCells.forEach(c => fitCell(mapCol(colIndex(c)), 18, false));
    if(!original){
      for(let r=19;r<=lastLearnerRow;r++){
        const learner=period.roster[r-19];if(!learner)continue;
        fitCell(1,r);
        const lines=String(learner.name||'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/29)),0);
        if(lines>1){ensureRow(r).setAttribute('ht',Math.max(16.2,lines*14));ensureRow(r).setAttribute('customHeight','1');}
      }
      for(const c of ['H','O','AG'].map(c=>mapCol(colIndex(c))))fitCell(c,13);
      const headerLines=Math.max(1,Math.ceil(String(section.subject||'').length/38),Math.ceil(String(metadata.teacherName||'').length/50),Math.ceil(String(section.level+' '+section.section).length/25));
      if(headerLines>1){ensureRow(13).setAttribute('ht',Math.max(28.5,headerLines*14+3));ensureRow(13).setAttribute('customHeight','1');}
    }
    // Keep the school's signatory lanes; the print layout wraps long names.
    const merges=sheet.getElementsByTagNameNS(NS,'mergeCells')[0];
    const signatureRows = [66, 68, 69];
    const mergeRefs=oldMerges.filter(ref => original || !signatureRows.includes(address(ref.split(':')[0]).r)).map(mapRef);
    if (!original) {
      for (const c of ['C', 'O', 'Y']) for (const r of signatureRows) W(c, r, '');
      for (const [start, end, source, caption, name, role] of signatures) {
        [caption, String(name || '').replace(/\s+/gu, ' ').trim(), role].forEach((value, i) => {
          const oldRow = signatureRows[i], r = mapRow(oldRow), c = mapCol(colIndex(start));
          write(c, r, value);
          cell(c, r).setAttribute('s', originalStyles.get(`${source}${oldRow}`) || '0');
          fitCell(c, r, false);
          mergeRefs.push(mapRef(`${start}${oldRow}:${end}${oldRow}`));
        });
      }
      for (const oldRow of [64, 65, 70, 72, 74]) {
        const spacer = ensureRow(mapRow(oldRow));
        spacer.setAttribute('ht', '6');
        spacer.setAttribute('customHeight', '1');
      }
    }
    for(let i=3;i<rawColumns.qa.length;i++)mergeRefs.push(`${col(rawColumns.qa[i])}15:${col(rawColumns.qa[i])}17`);
    const register={};
    for(const kind of ['ww','pt','qa'])register[kind]=period[kind+'Hps'].flatMap((hps,index)=>{
      const meta=period.activityMeta?.[kind]?.[index]||{},date=period[kind+'Dates'][index]||'';
      if(!present(hps)&&!present(date)&&!['title','topic','competency'].some(k=>present(meta[k])))return [];
      const role=meta.role||root.CSTRGrading.defaultRole(kind,index,section.gradingCategory || section.subject);
      return [{column:`${col(rawColumns[kind][index])}`,date,title:[meta.title,roleLabel(role)].filter(Boolean).join(' - '),topic:[meta.topic,meta.competency].filter(Boolean).join('\n'),topicOnly:meta.topic||'',competency:meta.competency||'',hps}];
    });
    merges.replaceChildren(...mergeRefs.map(ref=>el(doc,'mergeCell',{ref})));merges.setAttribute('count',mergeRefs.length);
    // Keep the failing-grade fill, with the same black number as every other grade.
    for(const formatting of [...sheet.getElementsByTagNameNS(NS,'conditionalFormatting')]){
      const start=formatting.getAttribute('sqref').split(':')[0];
      const gradeStart=`${col(mapCol(33))}19`,descriptorStart=`${col(mapCol(34))}19`;
      if(start===gradeStart){
        formatting.setAttribute('sqref',`${gradeStart}:${col(mapCol(33))}${lastLearnerRow}`);
        for(const rule of [...formatting.getElementsByTagNameNS(NS,'cfRule')]){
          const dxf = stylesDoc.getElementsByTagNameNS(NS, 'dxfs')[0]?.children[Number(rule.getAttribute('dxfId'))];
          dxf?.getElementsByTagNameNS(NS, 'font')[0]?.remove();
          rule.setAttribute('type','expression');rule.removeAttribute('operator');
          const formula=rule.getElementsByTagNameNS(NS,'formula')[0];formula.textContent=`AND(ISNUMBER(${gradeStart}),${gradeStart}<75)`;
        }
      }else if(start===descriptorStart) formatting.remove(); // The native descriptor rule only changed text to red.
    }
    for(const node of [...sheet.getElementsByTagNameNS(NS,'dataValidations')])node.remove();
    const validations=el(doc,'dataValidations');
    for(const kind of ['ww','pt','qa'])for(const c of rawColumns[kind]){
      const x=`${col(c)}19`,h=`${col(c)}$18`,validation=el(doc,'dataValidation',{type:'custom',allowBlank:1,showErrorMessage:1,errorTitle:'Check score and HPS',error:'Enter a score from 0 to HPS, or A, M, E, L.',sqref:`${col(c)}19:${col(c)}${lastLearnerRow}`});
      const options = componentRules[kind];
      const assigned = options.groups ? `,${col(c)}$${roleRow}<>""` : '';
      const formula=el(doc,'formula1');formula.textContent=`OR(${x}="",AND($B19<>"",ISNUMBER(${h}),${h}>0${assigned},OR(AND(ISNUMBER(${x}),${x}>=0,${x}<=${h}),UPPER(${x})="A",UPPER(${x})="M",UPPER(${x})="E",UPPER(${x})="L")))`;validation.appendChild(formula);validations.appendChild(validation);
      const maxValidation=el(doc,'dataValidation',{type:'custom',allowBlank:0,showErrorMessage:1,errorTitle:'Check HPS',error:'Enter a positive maximum in an assigned assessment column, or clear the column.',sqref:`${col(c)}18`});
      const maxFormula=el(doc,'formula1');maxFormula.textContent=`OR(${h}="",AND(ISNUMBER(${h}),${h}>0${assigned}))`;maxValidation.appendChild(maxFormula);validations.appendChild(maxValidation);
    }
    for(const [c,value] of fixedWeights){
      const ref=`${col(mapCol(colIndex(c)))}18`,v=el(doc,'dataValidation',{type:'custom',allowBlank:0,showErrorMessage:1,errorTitle:'Subject-specific weight',error:`Keep the selected subject's required WW/PT/EX and exam split weights. Change the class category in the website and export again to use a different scheme.`,sqref:ref});
      const f=el(doc,'formula1');f.textContent=`${ref}=${value}`;v.appendChild(f);validations.appendChild(v);
    }
    validations.setAttribute('count',validations.children.length);
    const before=[...sheet.children].find(n=>['hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','drawing'].includes(n.localName));sheet.insertBefore(validations,before||null);
    for(const view of [...sheet.getElementsByTagNameNS(NS,'sheetView')]){view.setAttribute('topLeftCell','A1');view.setAttribute('zoomScale','100');view.setAttribute('zoomScaleNormal','100');for(const selection of [...view.getElementsByTagNameNS(NS,'selection')])selection.remove();view.appendChild(el(doc,'selection',{activeCell:'B19',sqref:'B19'}));}
    const printLayout = await layoutPrint({ zip, doc, stylesDoc, rows, cell, write, mapCol, mapRow,
      lastCol, lastLearnerRow, roleRow, rawColumns, register, payload });
    for(const row of rows.values()){
      const sorted=[...row.children].sort((a,b)=>address(a.getAttribute('r')).c-address(b.getAttribute('r')).c);row.replaceChildren(...sorted);
    }
    sheetData.replaceChildren(...[...rows.entries()].sort((a,b)=>a[0]-b[0]).map(([,row])=>row));
    cellXfs.setAttribute('count',cellXfs.children.length);zip.file('xl/styles.xml',serialize(stylesDoc));
    zip.file('xl/worksheets/sheet1.xml',serialize(doc));
    const wb=parse(await zip.file('xl/workbook.xml').async('string'));
    const subjectSheet=String(section.subject||'').replace(/[\\/?*\[\]:()\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,31).replace(/^[\s']+|[\s']+$/g,'');
    const safeSheet = !subjectSheet || /^history$/i.test(subjectSheet) ? 'Class Record' : subjectSheet;
    wb.getElementsByTagNameNS(NS,'sheet')[0].setAttribute('name',safeSheet);
    const activitySheetName = safeSheet.toLowerCase() === 'activity register' ? 'Activity register (2)' : 'Activity register';
    const wbRels = parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const newId = `rId${Math.max(0,...[...wbRels.documentElement.children].map(n => Number(n.getAttribute('Id').replace(/^rId/,'')) || 0)) + 1}`;
    const relation = wbRels.createElementNS(relNS, 'Relationship');
    for (const [k,v] of Object.entries({ Id:newId, Type:'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', Target:'worksheets/sheet2.xml' })) relation.setAttribute(k,v);
    wbRels.documentElement.appendChild(relation); zip.file('xl/_rels/workbook.xml.rels',serialize(wbRels));
    const extraSheet = el(wb,'sheet',{name:activitySheetName,sheetId:4}); extraSheet.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','r:id',newId);
    wb.getElementsByTagNameNS(NS,'sheets')[0].appendChild(extraSheet);
    const types = parse(await zip.file('[Content_Types].xml').async('string'));
    const override = types.createElementNS('http://schemas.openxmlformats.org/package/2006/content-types','Override');
    override.setAttribute('PartName','/xl/worksheets/sheet2.xml'); override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
    types.documentElement.appendChild(override); zip.file('[Content_Types].xml',serialize(types));
    let names=wb.getElementsByTagNameNS(NS,'definedNames')[0];if(!names){names=el(wb,'definedNames');wb.documentElement.appendChild(names);}
    [...names.children].filter(n=>['_xlnm.Print_Area','_xlnm.Print_Titles'].includes(n.getAttribute('name'))).forEach(n=>n.remove());
    const escaped=`'${safeSheet.replace(/'/g,"''")}'`;
    for(const [name,value] of [['_xlnm.Print_Area',`${escaped}!$A$1:$${col(lastCol)}$${printLayout.endRow}`],['_xlnm.Print_Titles',`${escaped}!$1:$18,${escaped}!$A:$B`]]){const n=el(wb,'definedName',{name,localSheetId:0});n.textContent=value;names.appendChild(n);}
    const activityEscaped=`'${activitySheetName.replace(/'/g,"''")}'`;
    for(const [name,value] of [['_xlnm.Print_Area',`${activityEscaped}!$A$1:$G$${printLayout.registerEndRow}`],['_xlnm.Print_Titles',`${activityEscaped}!$1:$5`]]){const n=el(wb,'definedName',{name,localSheetId:1});n.textContent=value;names.appendChild(n);}
    let calc=wb.getElementsByTagNameNS(NS,'calcPr')[0];if(!calc){calc=el(wb,'calcPr');wb.documentElement.appendChild(calc);}calc.setAttribute('calcMode','auto');calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');
    zip.file('xl/workbook.xml',serialize(wb));
    // The original calc chain has stale references after layout/formula edits.
    zip.remove('xl/calcChain.xml');
    for(const path of ['xl/_rels/workbook.xml.rels','[Content_Types].xml']){
      const part=parse(await zip.file(path).async('string'));
      for(const node of [...part.documentElement.children])if((node.getAttribute('Type')||'').includes('calcChain')||node.getAttribute('PartName')==='/xl/calcChain.xml')node.remove();
      zip.file(path,serialize(part));
    }
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
    return {bytes,sheetName:safeSheet,range:`A1:${col(lastCol)}${printLayout.endRow}`,resultCells};
  }
  async function download(payload) {
    const result=await build(payload),blob=new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    if(root.CSTRFiles){await root.CSTRFiles.deliver(blob,[payload.section.level,payload.section.subject,payload.section.section,payload.period.name].filter(Boolean).join('-').replace(/[^a-z0-9]+/gi,'-')+'.xlsx');return result;}
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=[payload.section.level,payload.section.subject,payload.section.section,payload.period.name].filter(Boolean).join('-').replace(/[^a-z0-9]+/gi,'-')+'.xlsx';
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return result;
  }
  root.CSTRSchoolExcel={build,download,validate};
})(typeof window==='object'?window:globalThis);
