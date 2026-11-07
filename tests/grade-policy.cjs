'use strict';

const assert = require('node:assert/strict');
const grading = require('../ASSETS/grading-engine.js');

// DO 015, s. 2026, Annex D Tables 1–3, and DO 8, s. 2015 Table 5
// for the Grade 12 transition categories under paragraph 49.
const weights = [
  [20,50,30], [20,50,30], [20,50,30], [20,50,30], [20,50,30], [20,50,30], [20,60,20], [20,60,20],
  [20,50,30], [15,70,15], [20,60,20], [40,60,0], [15,65,20], [20,80,0],
  [25,50,25], [25,45,30], [35,40,25], [20,60,20]
];
const near = (value, expected) => assert(Math.abs(value - expected) < 1e-10, `${value} differs from ${expected}`);

function fixture(index) {
  const preset = grading.SUBJECT_PRESETS[index];
  const section = {
    group: index < 8 ? 'JHS' : 'SHS', level: index < 8 ? 'Grade 8' : index < 14 ? 'Grade 11' : 'Grade 12',
    section: 'Synthetic', subject: preset.name, gradingCategory: preset.name,
    gradingMode: 'school-transmutation', weights: weights[index]
  };
  const isValues = index === 5, termExamOnly = index === 9;
  const role = roles => roles.map(role => ({ role }));
  const period = {
    name: 'Quarter 1', wwDates: ['', ''], ptDates: ['', '', ''], qaDates: ['', '', ''],
    wwHps: [20, 10], ptHps: [15, 20, 30], qaHps: termExamOnly ? [null, null, 20] : [10, 10, 20],
    activityMeta: {
      ww: role(isValues ? ['cognitive', 'affective'] : ['', '']),
      pt: role(isValues ? ['cognitive', 'affective', 'behavioral'] : ['', '', '']),
      qa: role(termExamOnly ? ['te', 'te', 'te'] : ['st1', 'st2', 'te'])
    },
    roster: [{ name: 'Synthetic, Learner', ww: [12, 8], pt: [9, 18, 24], qa: termExamOnly ? ['', '', 18] : [6, 9, 18] }]
  };
  return { section, period, calendarMode: 'legacy' };
}

if (require.main === module) {
  assert.deepEqual(grading.SUBJECT_PRESETS.map(preset => preset.weights), weights);
  for (const [index, [ww, pt, exam]] of weights.entries()) {
    const { section, period } = fixture(index);
    const result = grading.calculateLearner(period.roster[0], period, section);
    near(result.ww.weighted, ww * (index === 5 ? .7 : 20 / 30));
    near(result.pt.weighted, pt * (index === 5 ? .78 : 51 / 65));
    near(result.qa.weighted, exam * (index === 9 ? .9 : .81));
    assert(Number.isInteger(result.initial.transmuted), section.subject);
  }

  // Independently transcribed lower bounds from Annex D Table 4, high to low.
  const cutoffs = [99.5,98.32,97.14,95.96,94.78,93.60,92.42,91.24,90.06,88.88,87.70,86.52,85.34,84.16,82.98,81.80,80.62,79.44,78.26,77.08,75.90,74.72,73.54,72.36,71.18,70,65.34,60.67,56.01,51.34,46.67,42.01,37.34,32.68,28.01,23.35,18.68,14.01,9.35,4.68,0];
  for (const [index, cutoff] of cutoffs.entries()) {
    assert.equal(grading.transmuteGrade(cutoff), 100 - index);
    if (cutoff) assert.equal(grading.transmuteGrade(cutoff - 0.000001), 99 - index);
  }

  const { section, period } = fixture(0);
  section.gradingMode = 'zero-based';
  period.roster[0] = { name: 'Synthetic, Learner', ww: [0, 0], pt: [0, 0, 0], qa: [0, 0, 0] };
  const zero = grading.calculateLearner(period.roster[0], period, section).initial;
  assert.equal(zero.precise, 0);
  assert.equal(zero.transmuted, 60);
  assert.equal(grading.scoreIssue('A', ''), 'missingHps');
  assert.equal(grading.scoreIssue('0x10', 20), 'invalidScores');
  assert.equal(grading.scoreIssue('5.000001', 5), 'aboveHps');
  assert.equal(grading.numberOrNull('69.9999999999999'), 69.9999999999999);
  assert.equal(grading.transmuteGrade(69.9999999999999), 74);
  assert.equal(grading.numberOrNull('69.99999999999999'), null);
  assert.equal(grading.scoreIssue(0, 5), '');
  assert.equal(grading.scoreIssue('', ''), '');
  assert.equal(grading.calculateComponent([1, 2], [10], 20).weighted, null);
  assert.match(grading.gradingIssue({ ...section, weights: [-10, 80, 30] }), /100%/);
  assert.match(grading.gradingIssue({ ...fixture(14).section, level: 'Grade 11' }), /Grade 12/);
  console.log('PASS 18 subject categories, 41 transmutation thresholds, zero-based reporting, and strict score/HPS validation.');
}

module.exports = { fixture };
