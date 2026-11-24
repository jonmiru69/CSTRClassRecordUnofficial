/* Deterministic CST-R Form 1 mapping. No network, credentials, or inferred scores. */
(function (root, factory) {
  const api = factory(root.CSTRGrading || (typeof require === 'function' && require('./grading-engine.js')));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CSTROfficialSyncEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function (grading) {
  'use strict';
  const kinds = ['ww', 'pt', 'qa'];
  const text = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const nameKey = value => text(value).replace(/^\d+\.\s*/, '').toLocaleLowerCase('en').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  const labelKey = value => nameKey(value).replace(/\bsaint\b/g, 'st').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function subjectKey(value) {
    const key = labelKey(value);
    if (/^(science|science technology|science and technology)$/.test(key)) return 'science';
    if (/^(general science(?: 11)?|gen science)$/.test(key)) return 'general science';
    return key;
  }
  function spreadsheetLink(input) {
    let url;
    try { url = new URL(input); } catch (_) { throw new Error('Paste the official Google Sheets file link, not the Drive home link.'); }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) throw new Error('Paste the official Google Sheets file link, not the Drive home link.');
    const gid = new URLSearchParams(url.hash.slice(1)).get('gid') || url.searchParams.get('gid');
    return { id: match[1], sheetId: gid !== null && /^\d+$/.test(gid) ? Number(gid) : null };
  }
  function identity(source, period) {
    if (source.calendarMode === 'trimester') throw new Error('The inspected official gradesheets use quarters. Trimester transfers are not supported.');
    const max = source.section.group === 'SHS' ? 2 : 4;
    if (!Number.isInteger(period.quarter) || period.quarter < 1 || period.quarter > max) throw new Error('A completed period has no valid quarter identity. Review its period settings.');
    if (max === 2 && (![1, 2].includes(period.semester) || period.semester !== source.semester)) throw new Error('A completed period belongs to a different semester.');
    return period.quarter;
  }
  function sourceRows(source) {
    const issue = grading.gradingIssue(source.section);
    if (issue) throw new Error(issue);
    if (source.section.gradingMode === 'zero-based') throw new Error('This official template uses school transmutation. Zero-based transfers are not supported.');
    if (!/^\d{4}-\d{4}$/.test(source.schoolYear)) throw new Error('Set the school year before transferring.');
    const rows = [], seenPeriods = new Set();
    for (const period of source.periods || []) {
      // The caller supplies completion from the same app check used on period tabs.
      if (period.complete !== true) continue;
      const quarter = identity(source, period);
      if (seenPeriods.has(quarter)) throw new Error(`Two completed periods claim quarter ${quarter}.`);
      seenPeriods.add(quarter);
      const names = new Set();
      for (const learner of period.roster || []) {
        if (!text(learner.name)) continue;
        const key = nameKey(learner.name);
        if (!key || names.has(key)) throw new Error(`Duplicate learner name in ${period.name}: ${text(learner.name)}.`);
        names.add(key);
        const result = grading.calculateLearner(learner, period, source.section);
        const values = kinds.map(kind => {
          const component = result[kind];
          if (component.error || component.missing || !Number.isFinite(component.weighted)) throw new Error(`${text(learner.name)} has an incomplete or invalid ${kind.toUpperCase()} component in ${period.name}.`);
          // Official inputs store two decimals, using the existing half-up rule.
          return grading.roundHalfUp(component.weighted, 2);
        });
        rows.push({ name: text(learner.name), key, quarter, values });
      }
      if (!names.size) throw new Error(`The completed period ${period.name} has no learners.`);
    }
    if (!rows.length) throw new Error('There are no completed periods to transfer.');
    return rows;
  }
  const entered = cell => cell?.userEnteredValue || {};
  const display = cell => cell?.formattedValue ?? cell?.effectiveValue?.stringValue ?? entered(cell).stringValue ?? entered(cell).numberValue ?? '';
  function matrix(sheet) {
    const rows = [];
    for (const grid of sheet.data || []) (grid.rowData || []).forEach((row, i) => {
      const r = (grid.startRow || 0) + i;
      rows[r] ||= [];
      (row?.values || []).forEach((cell, c) => { rows[r][(grid.startColumn || 0) + c] = cell; });
    });
    return rows;
  }
  function inspect(source, workbook, sheetId) {
    const sheet = workbook.sheets?.find(sheet => sheet.properties.sheetId === sheetId);
    if (!sheet) throw new Error('Choose a subject tab from the linked official workbook.');
    const rows = matrix(sheet);
    const headers = rows.slice(0, 30).map(row => (row || []).map(display).join(' ')).join(' ');
    if (!headers.includes('CST-R FORM 1')) throw new Error('This is not the inspected CST-R Form 1 template.');
    const year = headers.match(/S\.?Y\.?\s*(\d{4})\s*[-–]\s*(\d{4})/i);
    if (!year || `${year[1]}-${year[2]}` !== source.schoolYear) throw new Error('The official workbook school year does not match this transfer.');
    const heading = rows.slice(0, 15).flatMap(row => (row || []).map(display)).find(value => /SUBJECT\s*:/i.test(value));
    const meta = text(heading).match(/(?:YEAR\s*&\s*SECTION|YR\.?\s*&\s*SEC\.?)\s*:+\s*(\d+)\s*[-–]\s*(.*?)\s+SUBJECT\s*:\s*(.+)$/i);
    if (!meta || Number(meta[1]) !== Number(String(source.section.level).match(/\d+/)?.[0])) throw new Error('The official grade level or class heading does not match.');
    if (source.section.group === 'SHS') {
      const semester = /(?:FIRST|1ST)\s+SEMESTER/i.test(headers) ? 1 : /(?:SECOND|2ND)\s+SEMESTER/i.test(headers) ? 2 : null;
      if (semester !== source.semester) throw new Error('The official workbook semester does not match the completed periods.');
    }
    if (source.partition) {
      const label = `${workbook.properties.title} ${meta[2]}`;
      const stem = /\bSTEM\b/i.test(label), abm = /\bABM\b|\bB\s*&\s*E\b|business.*entrep/i.test(label);
      if ((source.partition === 'STEM' && (!stem || abm)) || (source.partition === 'ABM' && (!abm || stem)) || !['STEM','ABM'].includes(source.partition)) {
        throw new Error(`This source group is ${source.partition === 'ABM' ? 'B&E / ABM' : source.partition}. Link its matching official strand file.`);
      }
    }
    const header = rows.findIndex(row => /NAMES/i.test(display(row?.[0])) && /^(PERIOD|QUARTER)$/i.test(text(display(row?.[1]))));
    if (header < 0) throw new Error('The official NAMES and PERIOD/Quarter columns were not found.');
    const labels = ['Written Works', 'Performance Task', 'Quarterly Asses'];
    labels.forEach((label, i) => {
      const value = text(display(rows[header][i + 2]));
      const percent = value.match(/\((\d+(?:\.\d+)?)%\)/);
      if (!value.startsWith(label) || !percent || Number(percent[1]) !== source.section.weights[i]) throw new Error('Official WW/PT/QA headers or weights differ from the class record.');
    });
    if (!/Initial\s+Grade/i.test(text(display(rows[header][5]))) || !/Periodical\s+Grade/i.test(text(display(rows[header][6])))) throw new Error('The official grade formula columns were not found.');
    const count = source.section.group === 'SHS' ? 2 : 4;
    const students = new Map();
    for (let r = header + 1; r < rows.length; r++) {
      if (Number(display(rows[r]?.[1])) !== 1) continue;
      const name = text(display(rows[r]?.[0]));
      for (let p = 0; p < count; p++) if (Number(display(rows[r + p]?.[1])) !== p + 1) throw new Error('Unexpected official period rows. No scores can be mapped safely.');
      if (text(display(rows[r + count]?.[1])).toUpperCase() !== 'F') throw new Error('The official period count differs from the class record.');
      if (!name) { r += count; continue; }
      const key = nameKey(name);
      if (students.has(key)) throw new Error(`Duplicate learner name in the official sheet: ${name}.`);
      students.set(key, { name, row: r });
      r += count;
    }
    const mismatches = [];
    if (labelKey(meta[2]) !== labelKey(source.section.section)) mismatches.push(`Section: “${source.section.section}” in your record; “${meta[2]}” in the official sheet.`);
    if (subjectKey(meta[3]) !== subjectKey(source.section.subject)) mismatches.push(`Subject: “${source.section.subject}” in your record; “${meta[3]}” in the official sheet.`);
    return { sheet, rows, students, officialSection: meta[2], officialSubject: meta[3], mismatches };
  }
  function contains(range, sheetId, r, c) {
    return range && range.sheetId === sheetId && r >= (range.startRowIndex || 0) && r < (range.endRowIndex ?? Infinity) && c >= (range.startColumnIndex || 0) && c < (range.endColumnIndex ?? Infinity);
  }
  function editable(workbook, sheet, r, c) {
    return (sheet.protectedRanges || []).every(protection => {
      if (protection.warningOnly || protection.requestingUserCanEdit === true) return true;
      const range = protection.range || workbook.namedRanges?.find(n => n.namedRangeId === protection.namedRangeId)?.range;
      if (!range) return false;
      return !contains(range, sheet.properties.sheetId, r, c) || (protection.unprotectedRanges || []).some(open => contains(open, sheet.properties.sheetId, r, c));
    });
  }
  function plan(source, workbook, sheetId, acknowledgedHeading) {
    const data = inspect(source, workbook, sheetId);
    const { sheet, rows, students } = data;
    if (data.mismatches.length && acknowledgedHeading !== `${data.officialSection}|${data.officialSubject}`) throw new Error(data.mismatches.join(' ') + ' Verify this mapping explicitly before previewing.');
    const sourceData = sourceRows(source), used = new Map(), changes = [], allRows = [], skipped = [];
    for (const learner of sourceData) if (!used.has(learner.quarter)) used.set(learner.quarter,new Set());
    for (const learner of sourceData) {
      const target = students.get(learner.key);
      if (!target) { skipped.push({name:learner.name,quarter:learner.quarter}); continue; }
      used.get(learner.quarter).add(learner.key);
      const row = target.row + learner.quarter - 1, cells = rows[row] || [];
      if (!entered(cells[5]).formulaValue || !entered(cells[6]).formulaValue) throw new Error(`Missing official grade formulas at row ${row + 1}. Ask the registrar to repair the template.`);
      const before = Array.from({length:3}, (_,i)=>entered(cells[i+2]));
      before.forEach((value, i) => {
        if (value.formulaValue) throw new Error(`The official input ${'CDE'[i]}${row + 1} is a formula. It will not be replaced.`);
        if (!editable(workbook, sheet, row, i + 2)) throw new Error(`Your connected Google account cannot edit ${sheet.properties.title}!${'CDE'[i]}${row + 1}.`);
      });
      const item = { name: learner.name, quarter: learner.quarter, row, values: learner.values, before: Array.from({length:3}, (_,i)=>before[i] || {}), formulas: cells.slice(5, 7).map(entered) };
      allRows.push(item);
      if (item.values.some((value, i) => item.before[i].numberValue !== value)) changes.push(item);
    }
    // A learner can leave a class between quarters. No source entry means no
    // score to transfer, not zero and not permission to erase official history.
    const untouched = [];
    for (const [quarter,keys] of used) for (const [key,student] of students) if (!keys.has(key)) {
      const row=student.row+quarter-1;
      untouched.push({name:student.name,quarter,row,values:Array.from({length:3},(_,i)=>display(rows[row]?.[i+2]))});
    }
    return {
      sourceId: source.id, spreadsheetId: workbook.spreadsheetId, title: workbook.properties.title,
      sheetId, sheetTitle: sheet.properties.title, source, allRows, changes, untouched, skipped,
      overwrites: changes.reduce((sum, item) => sum + item.values.filter((v,i) => Object.keys(item.before[i]).length && item.before[i].numberValue !== v).length, 0),
      // Include names resolved through formulas, headings, inputs, and formula text.
      // Ignore computed F/G values, which may legitimately recalculate on a read.
      fingerprint: JSON.stringify({title:workbook.properties.title, properties:sheet.properties, protections:sheet.protectedRanges, namedRanges:workbook.namedRanges,
        rows:rows.map(row=>(row||[]).map((cell,c)=>({value:entered(cell),...(c<2?{label:display(cell)}:{})})))})
    };
  }
  function requests(plans) {
    const seen = new Set();
    for (const plan of plans) for (const item of plan.allRows) {
      const key = `${plan.spreadsheetId}|${plan.sheetId}|${item.row}`;
      if (seen.has(key)) throw new Error('Two classes map to the same official period row. Review the links.');
      seen.add(key);
    }
    return plans.flatMap(plan => plan.changes.map(item => {
      return { updateCells: { start: { sheetId: plan.sheetId, rowIndex: item.row, columnIndex: 2 }, rows: [{values:item.values.map(numberValue=>({userEnteredValue:{numberValue}}))}], fields:'userEnteredValue' } };
    }));
  }
  function verify(plan, workbook) {
    const rows = matrix(workbook.sheets.find(s => s.properties.sheetId === plan.sheetId) || {});
    return plan.allRows.every(item => item.values.every((v,i) => entered(rows[item.row]?.[i+2]).numberValue === v) && item.formulas.every((f,i) => JSON.stringify(entered(rows[item.row]?.[i+5])) === JSON.stringify(f)));
  }
  return { nameKey, subjectKey, spreadsheetLink, identity, sourceRows, inspect, plan, requests, verify, matrix };
});
