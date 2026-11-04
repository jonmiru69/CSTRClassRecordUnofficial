'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const grading = require('../ASSETS/grading-engine.js');
const performance = require('../ASSETS/performance-analysis.js');

function analyze(scores, maxima, overrides = {}, weights = [100, 0, 0]) {
  const result = {
    ww: grading.calculateComponent(scores, maxima, weights[0]),
    pt: grading.calculateComponent([], [], weights[1]),
    qa: grading.calculateComponent([], [], weights[2])
  };
  const rows = scores.map((score, index) => ({
    kind: 'ww', index, score, hps: maxima[index], meta: { title: 'Fixture ' + index }, ...overrides[index]
  }));
  return performance.analyze(rows, weights, result, 'Quarterly Assessment');
}

test('preserves engine percentage while separating learning evidence from attendance and blanks', () => {
  const report = analyze(['10', '0', '', 'M', 'A', 'E', 'L'], ['10', '10', '10', '10', '10', '10', '10']);
  assert.match(report.sections[0].lines.join(' '), /Written Works 20\.00%.*2 usable numeric results/);
  assert.match(report.sections[0].lines.join(' '), /1 pending.*1 marked missing.*1 marked absent.*1 excused.*1 marked late/);
  assert.match(report.sections[1].lines.join(' '), /Fixture 0.*10\/10/);
  assert.match(report.sections[2].lines.join(' '), /Fixture 1.*0\/10/);
  assert.match(report.sections[3].lines.join(' '), /pending.*missing or missed.*Fixture 1/);
});

test('uses original scores for bonuses and excludes revised HPS and invalid entries', () => {
  const report = analyze(['10', '9', '5', '12', '4', '1e2'], ['10', '10', '5', '10', '', '100'], {
    0: { ledger: { raw: '2.500', entries: [{ points: 7.5 }] }, meta: { title: 'Topic activity', topic: 'Named topic' } },
    2: { original: { score: '8', hps: '10', applied: '5' } }
  });
  assert.match(report.sections[1].lines.join(' '), /9\/10/);
  assert.match(report.sections[2].lines.join(' '), /2\.500\/10 \(25\.00%, before added points\)/);
  assert.match(report.sections[0].lines.join(' '), /3 need a score or HPS check.*1 excluded.*1 with added points/);
  assert.match(report.sections[3].lines.join(' '), /Review Named topic using WW 1/);
});

test('handles ties, no evidence, disabled components, and denominator errors', () => {
  assert.match(analyze(['1', '3'], ['2', '6']).sections[1].lines[0], /tied/);
  assert.match(analyze(['1'], ['2']).sections[1].lines[0], /Only one/);
  assert.equal(analyze([''], ['']).draft, null);
  assert.equal(analyze(['10'], ['10'], {}, [0, 100, 0]).draft, null);
  assert.equal(analyze(['1'], ['0']).draft.context.issues.invalid, 1);
  assert.match(analyze(['2', '2', '1'], ['3', '3', '3']).sections[1].lines.join(' '), /Fixture 0.*Fixture 1/);
});

test('accepts only verified model choices and keeps activity titles out of the prompt', async () => {
  const { draft } = analyze(['2'], ['10'], { 0: { meta: { title: 'Private student material', topic: 'Private topic' } } });
  let destroyed = 0;
  const model = {
    async availability(options) { assert.equal(options.expectedInputs[0].languages[0], 'en'); return 'available'; },
    async create({ signal, monitor }) {
      assert.equal(signal.aborted, false);
      assert.equal(typeof monitor, 'function');
      return {
        async prompt(prompt, options) {
          assert.doesNotMatch(prompt, /Private/);
          assert.deepEqual(options.responseConstraint.properties.action.enum, [0]);
          return this.response || '{"action":0,"style":1}';
        },
        response: model.response,
        destroy() { destroyed++; }
      };
    }
  };
  const options = { signal: new AbortController().signal, onDownload() {} };
  assert.match(await performance.draftFeedback(model, draft, options), /manageable.*Private topic/);
  model.response = '{"action":999,"style":0}';
  await assert.rejects(performance.draftFeedback(model, draft, options), /Invalid feedback selection/);
  model.response = '{"action":0,"style":0,"claim":"made up"}';
  await assert.rejects(performance.draftFeedback(model, draft, options), /Invalid feedback selection/);
  assert.equal(destroyed, 3);
  assert.equal(await performance.draftFeedback({ availability: async () => 'unavailable' }, draft, options), null);
  await assert.rejects(performance.draftFeedback(model, draft, { ...options, signal: AbortSignal.abort() }), { name: 'AbortError' });
});
