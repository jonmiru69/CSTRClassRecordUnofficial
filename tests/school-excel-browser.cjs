'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright-core');
const grading = require('../ASSETS/grading-engine.js');
const { fixture } = require('./grade-policy.cjs');

const assets = path.resolve(__dirname, '../ASSETS');
const output = path.resolve(__dirname, '../.build-artifacts/school-excel');
const snapshotsPath=path.join(__dirname,'fixtures/school-excel-content.json');
const recordBaseline=Boolean(process.env.CSTR_EXPORT_BASELINE);
const contentSnapshots=recordBaseline?{}:JSON.parse(fs.readFileSync(snapshotsPath,'utf8'));

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const manifest = [];
  try {
    const page = await browser.newPage();
    for (const script of ['vendor/jszip.min.js', 'grading-engine.js', 'record-tools.js', 'school-excel.js']) {
      await page.addScriptTag({ path: script==='school-excel.js'&&recordBaseline?path.resolve(process.env.CSTR_EXPORT_BASELINE):path.join(assets, script) });
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
    const fractional = fixture(0);
    fractional.section.gradingCategory = 'custom';
    fractional.section.weights = [20.125, 49.625, 30.25];
    fractional.period.roster[0].qa[0] = 6.125;
    cases.push(['fractional-weights', fractional]);
    const layout = fixture(0);
    layout.metadata = {
      schoolYear: '2026-2027',
      teacherName: 'Villanueva de los Santos y Fernández,\nMaría Alexandra Gabriela Maximiliana',
      checkerName: 'Montemayor de la Cruz y Castillo, Isabela Mariana Sofia Valentina',
      reviewerName: 'Santiago de los Reyes y Domingo, Juan Miguel Antonio Alejandro',
      principalName: 'Fernández de los Ángeles y Mendoza, Catalina Teresa Victoria Josefina'
    };
    const sample = layout.period.roster[0];
    layout.period.roster = Array.from({ length: 48 }, (_, index) => ({ ...sample, name: `Synthetic, Learner ${index + 1}` }));
    layout.period.roster[3] = { name: 'Low, Learner', ww: [0, 0], pt: [0, 0, 0], qa: [0, 0, 0] };
    layout.period.roster[47].name = 'Synthetic, Last Learner';
    layout.period.wwDates[0] = '2026-11-01';
    layout.period.wwDates[1] = '2026-12-31';
    layout.period.ptDates[0] = '2026-12-31';
    layout.period.qaDates[0] = '2026-12-31';
    layout.period.activityMeta.ww[0].title = 'Final print check';
    cases.push(['print-layout', layout]);
    const thirty=fixture(0);
    thirty.metadata={schoolYear:'2026-2027',teacherName:'Synthetic Teacher',checkerName:'Synthetic Checker',reviewerName:'Synthetic Coordinator',principalName:'Synthetic Principal'};
    thirty.period.roster=Array.from({length:30},(_,i)=>({...structuredClone(thirty.period.roster[0]),name:`Synthetic, Learner ${i+1}`}));
    thirty.period.wwDates=['2026-12-31','2026-11-01'];
    cases.push(['thirty-learners',thirty]);
    const many=structuredClone(thirty);
    many.period.roster=Array.from({length:65},(_,i)=>({...structuredClone(thirty.period.roster[0]),name:`Synthetic, Learner ${i+1}`}));
    cases.push(['many-learners',many]);
    const longActivity=fixture(0);
    longActivity.metadata=structuredClone(thirty.metadata);
    longActivity.period.roster[0].name='Villanueva de los Santos y Fernández, María Alexandra Gabriela';
    longActivity.period.wwDates[0]='2026-12-31';
    longActivity.period.activityMeta.ww[0]={title:'=Literal activity title — classroom discussion',topic:'Discuss and reflect on the evidence. '.repeat(6),competency:'Interpret and explain learning evidence. '.repeat(8)};
    cases.push(['long-activity',longActivity]);
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

    const activeCases=process.env.CSTR_EXPORT_CASES?cases.filter(([label])=>process.env.CSTR_EXPORT_CASES.split('|').includes(label)):cases;
    for (const [label, payload] of activeCases) {
      const expected = grading.calculateLearner(payload.period.roster[0], payload.period, payload.section);
      const info = await page.evaluate(async ({payload, template}) => {
        const templateBytes = Uint8Array.from(atob(template), c => c.charCodeAt(0));
        const result = await CSTRSchoolExcel.build(payload, { templateBytes });
        const zip = await JSZip.loadAsync(result.bytes);
        const doc = new DOMParser().parseFromString(await zip.file('xl/worksheets/sheet1.xml').async('string'), 'application/xml');
        const cells = [...doc.querySelectorAll('row[r="19"] c')].filter(cell => cell.querySelector('f'));
        const values = cells.slice(-3).map(cell => [cell.getAttribute('r'), cell.querySelector('v').textContent]);
        const styles = new DOMParser().parseFromString(await zip.file('xl/styles.xml').async('string'), 'application/xml');
        const readCell = ref => doc.querySelector(`c[r="${ref}"]`);
        const readCellStyle = ref => styles.querySelector('cellXfs').children[Number(readCell(ref).getAttribute('s') || 0)];
        const value = ref => readCell(ref)?.querySelector('v')?.textContent;
        const attributes = selector => Object.fromEntries([...doc.querySelector(selector).attributes].map(({name, value}) => [name, value]));
        const offset = Math.max(0, payload.period.roster.length - 45);
        const expanded = payload.period.wwHps.length > 10;
        const content=[...doc.querySelectorAll('sheetData c')].filter(c=>c.querySelector('f,v,is')?.textContent).map(c=>[c.getAttribute('r'),c.getAttribute('t')||'',...['f','v','is'].map(tag=>c.querySelector(tag)?.textContent||'')]);
        const workbookDoc=new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml');
        const grid=[...doc.querySelectorAll('sheetData row')].filter(r=>Number(r.getAttribute('r'))>=14&&Number(r.getAttribute('r'))<=63+offset).flatMap(r=>[...r.children]);
        const borderFailures=grid.filter(c=>{
          const xf=styles.querySelector('cellXfs').children[Number(c.getAttribute('s')||0)];
          const border=styles.querySelector('borders').children[Number(xf.getAttribute('borderId')||0)];
          return !['left','right','top','bottom'].every(side=>border.querySelector(side)?.getAttribute('style'));
        }).map(c=>c.getAttribute('r'));
        const activeFontSizes=[...doc.querySelectorAll('sheetData row')].filter(r=>Number(r.getAttribute('r'))<=82+offset).flatMap(r=>[...r.children]).map(c=>{
          const xf=styles.querySelector('cellXfs').children[Number(c.getAttribute('s')||0)];
          return Number(styles.querySelector('fonts').children[Number(xf.getAttribute('fontId')||0)].querySelector('sz').getAttribute('val'));
        });
        return {
          borderFailures,maxFont:Math.max(...activeFontSizes),
          content:JSON.stringify({cells:content,merges:[...doc.querySelectorAll('mergeCell')].map(n=>n.getAttribute('ref'))}),
          sheetCount:workbookDoc.querySelectorAll('sheet').length,
          area:workbookDoc.querySelector('definedName[name="_xlnm.Print_Area"]').textContent,
          dateWidths:[...doc.querySelectorAll('col')].filter(c=>[...Array(10)].some((_,i)=>Number(c.getAttribute('min'))===i+3)||[...Array(8)].some((_,i)=>Number(c.getAttribute('min'))===i+15)).map(c=>Number(c.getAttribute('width'))),
          values,
          formulaLength: Math.max(...cells.map(cell => cell.querySelector('f').textContent.length)),
          validations: doc.querySelectorAll('dataValidation').length,
          workbook: Array.from(result.bytes),
          mergedRanges: doc.querySelectorAll('mergeCell').length,
          pageSetup: attributes('pageSetup'), margins: attributes('pageMargins'),
          printOptions: attributes('printOptions'),
          fitToPage: doc.querySelector('pageSetUpPr').getAttribute('fitToPage'),
          manualBreaks: doc.querySelectorAll('rowBreaks,colBreaks').length,
          fonts: [...styles.querySelectorAll('fonts font color')].map(font => font.getAttribute('rgb')),
          gradeRuleFont: Boolean(styles.querySelector('dxfs').children[2].querySelector('font')),
          conditionalFormats: doc.querySelectorAll('conditionalFormatting').length,
          blankRowsHidden: doc.querySelector('row[r="20"]').getAttribute('hidden') === '1',
          componentWeights: expanded ? [] : ['N18', 'X18', 'AF18'].map(ref => Number(value(ref))),
          examWeights: expanded ? [] : ['AB18', 'AC18', 'AD18'].map(ref => Number(value(ref))),
          headings: ['C14', 'C15', expanded ? '' : 'O15'].map(value),
          rawExam: expanded ? null : [value('Y19'), readCellStyle('Y19').getAttribute('numFmtId')],
          signatures: expanded ? [] : ['B', 'K', 'U', 'AD'].map(c => {
            const ref = `${c}${68 + offset}`, style = readCellStyle(ref).querySelector('alignment');
            return [readCell(ref).querySelector('t')?.textContent, style.getAttribute('wrapText'), style.getAttribute('shrinkToFit')];
          })
        };
      }, { payload, template });
      const fingerprint=crypto.createHash('sha256').update(info.content).digest('hex');
      if(recordBaseline){contentSnapshots[label]=fingerprint;continue;}
      assert.equal(fingerprint,contentSnapshots[label],`${label}: existing content, formulas, positions and merged table layout must be preserved`);
      assert.equal(info.sheetCount,1,label);
      assert.deepEqual(info.borderFailures,[],label);
      assert(info.maxFont<=15,label);
      assert.equal(info.area.match(/!\$A\$\d+:\$[A-Z]+\$\d+/g).length,2,label);
      if(label!=='expanded-grouped-record') assert.equal(new Set(info.dateWidths).size,1,label);
      assert(info.formulaLength < 8192, label);
      assert(info.validations >= 42 && info.mergedRanges > 20, label);
      assert.deepEqual(info.pageSetup, { paperSize: '14', orientation: 'landscape', fitToWidth: '1', fitToHeight: '1' }, label);
      assert.deepEqual(info.margins, { left: '0.25', right: '0.25', top: '0.25', bottom: '0.25', header: '0.1', footer: '0.1' }, label);
      assert.equal(info.fitToPage, '1', label);
      assert.equal(info.printOptions.horizontalCentered, '1', label);
      assert.equal(info.printOptions.verticalCentered, '1', label);
      assert.equal(info.manualBreaks, 0, label);
      assert(info.fonts.length && info.fonts.every(rgb => rgb === 'FF000000') && !info.gradeRuleFont, label);
      assert.equal(info.conditionalFormats, 1, label);
      if (label !== 'expanded-grouped-record') {
        assert.deepEqual(info.componentWeights, payload.section.weights.map(weight => weight / 100), label);
        assert.deepEqual(info.examWeights, payload.section.weights[2] === 0 ? [0, 0, 0] : label === 'preset-9' ? [0, 0, 1] : [.3, .3, .4], label);
      }
      if (label === 'print-layout') {
        assert.deepEqual(info.signatures, Object.values(layout.metadata).slice(1).map(name => [name.replace('\n', ' '), '1', '0']));
        assert(!info.blankRowsHidden);
      } else assert.equal(info.blankRowsHidden,payload.period.roster.length===1,label);
      if (label === 'fractional-weights') {
        assert.match(info.headings[0], /20\.125%/);
        assert.deepEqual(info.rawExam, ['6.125', '0']);
      }
      if (label === 'preset-5') {
        assert.match(info.headings[1], /Grade shares \(Cognitive 10% \/ Affective 10%\)/);
        assert.match(info.headings[2], /Grade shares \(Cognitive 10% \/ Affective 10% \/ Behavioral 30%\)/);
      }
      assert(Math.abs(Number(info.values[0][1]) - expected.initial.precise) < 1e-10, label);
      assert.equal(Number(info.values[1][1]), expected.initial.transmuted, label);
      const descriptor = expected.initial.descriptor + (label === 'pending-and-attendance' ? ' (pending)' : '');
      assert.equal(info.values[2][1], descriptor, label);
      fs.writeFileSync(path.join(output, `${label}.xlsx`), Buffer.from(info.workbook));
      const changed=structuredClone(payload);changed.period.roster[0].ww[0]=Number(changed.period.wwHps[0]);
      const changedResult=grading.calculateLearner(changed.period.roster[0],changed.period,changed.section);
      manifest.push({ label, cells: info.values.map(([address]) => address), initial: expected.initial.precise,
        grade: expected.initial.transmuted, descriptor, changedScore:changed.period.roster[0].ww[0],changedInitial:changedResult.initial.precise,changedGrade:changedResult.initial.transmuted });
    }

    if(recordBaseline){fs.mkdirSync(path.dirname(snapshotsPath),{recursive:true});fs.writeFileSync(snapshotsPath,JSON.stringify(contentSnapshots,null,2)+'\n');console.log(`Recorded ${cases.length} original-export content fingerprints.`);return;}
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
    console.log(`PASS ${activeCases.length} native-template workbooks and 3 invalid export cases.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
