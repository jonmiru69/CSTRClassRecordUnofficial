'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const grading = require('../ASSETS/grading-engine.js');
const { fixture } = require('./grade-policy.cjs');

const assets = path.resolve(__dirname, '../ASSETS');
const output = path.resolve(__dirname, '../.build-artifacts/school-excel');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const manifest = [];
  try {
    const page = await browser.newPage();
    for (const script of ['vendor/jszip.min.js', 'grading-engine.js', 'record-tools.js', 'school-excel.js']) {
      await page.addScriptTag({ path: path.join(assets, script) });
    }
    const template = fs.readFileSync(path.join(assets, 'templates/cstr-class-record.xlsx')).toString('base64');
    const cases = grading.SUBJECT_PRESETS.map((_, index) => [`preset-${index}`, fixture(index)]);
    const zero = fixture(0);
    zero.section.gradingMode = 'zero-based';
    zero.calendarMode = 'trimester';
    zero.period.name = 'Term 1';
    zero.period.roster[0].ww = [0, 0];
    zero.period.roster[0].pt = [0, 0, 0];
    zero.period.roster[0].qa = [0, 0, 0];
    cases.push(['zero-based', zero]);
    const boundary = fixture(0);
    boundary.section.gradingCategory = 'custom';
    boundary.section.weights = [100, 0, 0];
    boundary.period.wwHps = [100, ''];
    boundary.period.roster[0].ww = ['69.9999999999999', ''];
    cases.push(['precision-boundary', boundary]);
    const pending = fixture(5);
    pending.period.roster[0].ww = ['E', ''];
    pending.period.roster[0].pt = ['A', 'M', 24];
    pending.period.roster[0].qa = ['L', 9, 18];
    cases.push(['pending-and-attendance', pending]);
    const alternating = fixture(5);
    const count = 270;
    alternating.period.wwDates = Array(count).fill('');
    alternating.period.wwHps = Array(count).fill(10);
    alternating.period.activityMeta.ww = Array.from({length: count}, (_, index) => ({role: index % 2 ? 'affective' : 'cognitive'}));
    alternating.period.roster[0].ww = Array(count).fill(8);
    cases.push(['expanded-grouped-record', alternating]);

    for (const [label, payload] of cases) {
      const expected = grading.calculateLearner(payload.period.roster[0], payload.period, payload.section);
      const info = await page.evaluate(async ({payload, template}) => {
        const templateBytes = Uint8Array.from(atob(template), c => c.charCodeAt(0));
        const result = await CSTRSchoolExcel.build(payload, { templateBytes });
        const zip = await JSZip.loadAsync(result.bytes);
        const doc = new DOMParser().parseFromString(await zip.file('xl/worksheets/sheet1.xml').async('string'), 'application/xml');
        const cells = [...doc.querySelectorAll('row[r="19"] c')].filter(cell => cell.querySelector('f'));
        const values = cells.slice(-3).map(cell => [cell.getAttribute('r'), cell.querySelector('v').textContent]);
        return {
          values,
          formulaLength: Math.max(...cells.map(cell => cell.querySelector('f').textContent.length)),
          validations: doc.querySelectorAll('dataValidation').length,
          workbook: Array.from(result.bytes),
          mergedRanges: doc.querySelectorAll('mergeCell').length
        };
      }, { payload, template });
      assert(info.formulaLength < 8192, label);
      assert(info.validations >= 42 && info.mergedRanges > 20, label);
      assert(Math.abs(Number(info.values[0][1]) - expected.initial.precise) < 1e-10, label);
      assert.equal(Number(info.values[1][1]), expected.initial.transmuted, label);
      const descriptor = expected.initial.descriptor + (label === 'pending-and-attendance' ? ' (pending)' : '');
      assert.equal(info.values[2][1], descriptor, label);
      fs.writeFileSync(path.join(output, `${label}.xlsx`), Buffer.from(info.workbook));
      manifest.push({ label, cells: info.values.map(([address]) => address), initial: expected.initial.precise,
        grade: expected.initial.transmuted, descriptor });
    }

    const invalid = fixture(0);
    invalid.period.roster[0].ww[0] = '1e2';
    const validate = payload => page.evaluate(payload => CSTRSchoolExcel.validate(payload), payload);
    await assert.rejects(validate(invalid), /enter a score from zero to HPS/i);
    invalid.period.roster[0].ww[0] = 0;
    invalid.period.wwHps[0] = '';
    await assert.rejects(validate(invalid), /no positive HPS/i);
    invalid.period.wwHps[0] = 20;
    invalid.period.roster[0].name = '';
    await assert.rejects(validate(invalid), /name the learner/i);
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`PASS ${cases.length} native-template workbooks and 3 invalid export cases.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
