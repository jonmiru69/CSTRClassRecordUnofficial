'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const preview = fs.readFileSync(path.join(root, 'test-preview/index.html'), 'utf8').replace('let revision=1;', `
  const [first, second] = state.sections.science.periods;
  second.quarter = 2;
  first.roster[1].name = first.roster[0].name;
  second.roster[1].name = second.roster[0].name;
  first.roster[1].ww[0] = '4';
  second.roster[0].ww[0] = '3';
  second.roster[1].ww[0] = '2';
  let revision=1;
`);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf' };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (file === path.join(root, 'test-preview/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(preview);
    return;
  }
  fs.readFile(file, (error, data) => res.writeHead(error ? 404 : 200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream'
  }).end(data));
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const native = await browser.newPage();
    await native.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await native.goto(origin + '/test-preview/index.html');
    console.log('Host Chrome local model:', await native.evaluate(async () => {
      try {
        return await window.LanguageModel?.availability({
          expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }]
        }) ?? 'API unavailable';
      } catch (error) { return error.name; }
    }));
    await native.close();

    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      window.testModel = { mode: 'ready', prompt: '', destroyed: 0 };
      Object.defineProperty(window, 'LanguageModel', { configurable: true, value: {
        availability: async () => window.testModel.mode === 'unavailable' ? 'unavailable' : 'available',
        async create() {
          return {
            async prompt(prompt, { signal }) {
              window.testModel.prompt = prompt;
              if (window.testModel.mode === 'fail') throw new Error('Fixture inference failure');
              if (window.testModel.mode === 'wait') await new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              });
              return '{"style":1,"action":0}';
            },
            destroy() { window.testModel.destroyed++; }
          };
        }
      } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/test-preview/index.html?screen=record');
    await page.locator('#view-tab-one').click();
    const report = page.locator('.editable-student-report');
    const analysis = report.locator('.student-analysis');
    const button = analysis.getByRole('button', { name: 'Draft feedback with AI' });
    const note = analysis.locator('textarea');
    assert.match(await analysis.innerText(), /Current performance.*Strengths.*Areas to improve.*What to do next/s);
    assert.match(await analysis.innerText(), /1 pending/);
    assert.equal(await report.locator('.student-result-priority').count(), 1);
    assert.match(await report.locator('.student-result-priority').innerText(), /Provisional grade/);

    await button.click();
    await note.waitFor({ state: 'visible' });
    assert.match(await note.inputValue(), /pending scores/);
    assert.doesNotMatch(await page.evaluate(() => testModel.prompt), /Alvarez|Matter and measurement|Saint Sample/);
    await note.fill('Teacher-reviewed wording');
    assert.equal(await note.inputValue(), 'Teacher-reviewed wording');

    const downloadEvent = page.waitForEvent('download');
    await report.getByRole('button', { name: 'Save this period PNG' }).click();
    const download = await downloadEvent;
    const png = fs.readFileSync(await download.path());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const svg = await report.locator('.student-report-svg').textContent();
    assert.match(svg, /Performance analysis.*Current performance.*Activity record/s);
    assert.doesNotMatch(svg, /Teacher-reviewed wording/);

    await page.evaluate(() => { testModel.mode = 'wait'; });
    await button.click();
    await analysis.getByRole('button', { name: 'Cancel' }).click();
    await analysis.getByText('Drafting cancelled.').waitFor();
    await page.evaluate(() => { testModel.mode = 'fail'; });
    await button.click();
    await analysis.getByText('Could not draft feedback.', { exact: false }).waitFor();
    await page.evaluate(() => { testModel.mode = 'unavailable'; });
    await button.click();
    await analysis.getByText('The on-device model is unavailable here.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => testModel.destroyed), 3);

    const score = report.locator('input[data-score="ww"][data-index="0"]');
    await score.fill('6');
    await score.press('Tab');
    await analysis.getByText(/6\/20/).waitFor();
    assert.equal(await note.isVisible(), false);
    const search = page.locator('#studentSearch');
    await search.fill('Alvarez, Sample');
    await search.press('Enter');
    const lookup = page.getByRole('dialog', { name: 'Student result' });
    const science = lookup.locator('.student-perf-block').filter({ hasText: 'Science · Saint Sample' });
    await science.waitFor();
    const first = science.locator('[role="tabpanel"]:not([hidden]) .report-readable');
    assert.equal(await first.count(), 2);
    const assess = row => row.getByRole('button', { name: 'Let Tommy assess Alvarez, Sample’s performance?', exact: true });
    const findings = row => row.locator('[data-tommy-findings]');
    assert.equal(await findings(first.nth(0)).isVisible(), false);
    assert.match(await assess(first.nth(0)).textContent(), /Let Tommy assess Alvarez, Sample’s performance/);
    await page.evaluate(() => { testModel.mode = 'ready'; });
    await assess(first.nth(0)).click();
    const tommyNote = first.nth(0).locator('[data-ai-note]');
    await tommyNote.waitFor({ state: 'visible' });
    await tommyNote.fill('Teacher-reviewed Tommy note <sample>.');
    const include = first.nth(0).getByRole('checkbox', { name: 'Include this reviewed feedback in the PNG' });
    assert.equal(await include.isChecked(), false);
    await include.check();
    await first.nth(0).getByRole('button', { name: 'Hide Tommy’s assessment' }).click();
    assert.equal(await findings(first.nth(0)).isVisible(), false);
    await first.nth(0).getByRole('button', { name: 'Show Tommy’s assessment' }).click();
    assert.equal(await tommyNote.inputValue(), 'Teacher-reviewed Tommy note <sample>.');
    assert.equal(await findings(first.nth(1)).isVisible(), false);
    await page.evaluate(() => {
      const serialize = XMLSerializer.prototype.serializeToString;
      XMLSerializer.prototype.serializeToString = function (node) {
        const xml = serialize.call(this, node);
        if (node.classList?.contains('student-report-svg')) window.exportedStudentSvg = xml;
        return xml;
      };
    });
    const tommyDownload = page.waitForEvent('download');
    await first.nth(0).locator('[data-action="export-student-png"]').click();
    const tommyPng = fs.readFileSync(await (await tommyDownload).path());
    assert.equal(tommyPng.subarray(1, 4).toString(), 'PNG');
    assert.match(await page.evaluate(() => exportedStudentSvg), /Tommy’s performance assessment.*Teacher-reviewed Tommy note &lt;sample&gt;.*Activity record/s);
    await page.evaluate(() => { testModel.mode = 'unavailable'; });
    await assess(first.nth(1)).click();
    await first.nth(1).getByText('Assessment ready from the recorded scores.', { exact: false }).waitFor();
    assert.match(await first.nth(0).innerText(), /roster row 1.*6\/20/s);
    assert.match(await first.nth(1).innerText(), /roster row 2.*4\/20/s);
    await science.getByRole('tab', { name: 'Quarter 2' }).click();
    await assess(first.nth(0)).click();
    await assess(first.nth(1)).click();
    assert.match(await first.nth(0).innerText(), /roster row 1.*3\/20/s);
    assert.match(await first.nth(1).innerText(), /roster row 2.*2\/20/s);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await science.locator('.student-analysis').filter({ visible: true }).count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    console.log('PASS desktop and phone report hierarchy, Tommy assessment and PNG feedback, same-name isolation, score refresh, and AI draft/cancel/failure/fallback.');
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
