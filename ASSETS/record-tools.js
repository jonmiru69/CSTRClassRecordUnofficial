/* Data-only record operations. Provenance is stored with its learner, so row
   deletion, JSON export, local recovery and cloud sync retain correct ownership. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CSTRRecordTools = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const kinds = ['ww', 'pt', 'qa'];
  const present = v => v !== '' && v !== null && v !== undefined && String(v).trim() !== '';
  const numeric = v => present(v) && Number.isFinite(Number(v)) && Number(v) >= 0;
  // Only explicit roster dividers are categories. Names such as Boysen are learners.
  const category = name => /^(?:boys|girls)\s*:?$/i.test(String(name || '').trim());

  function setScore(learner, kind, index, value) {
    if (!kinds.includes(kind)) throw new Error('Unknown assessment component');
    // Every explicit edit wins, even if it equals the temporarily capped score.
    if (learner.hpsOriginals?.[kind]) delete learner.hpsOriginals[kind][index];
    learner[kind][index] = value;
  }

  function adjustHps(period, kind, index, previous, next) {
    if (period.locked || !kinds.includes(kind)) return { capped: 0, restored: 0 };
    const result = { capped: 0, restored: 0 };
    period[kind + 'Hps'][index] = next;
    if (!numeric(next) || Number(next) <= 0) return result;
    period.roster.forEach(learner => {
      if (category(learner.name)) return;
      const value = learner[kind][index];
      let origin = learner.hpsOriginals?.[kind]?.[index];
      if (origin && String(value) !== String(origin.applied)) {
        delete learner.hpsOriginals[kind][index];
        origin = null;
      }
      if (origin && numeric(origin.score)) {
        const restored = Number(next) >= Number(origin.hps);
        // Intermediate ceilings stay capped; restoration of the original HPS
        // restores the exact original value (including its string precision).
        const adjusted = restored ? origin.score : String(Math.min(Number(origin.score), Number(next)));
        if (String(value) !== String(adjusted)) result[Number(adjusted) < Number(value) ? 'capped' : 'restored']++;
        learner[kind][index] = adjusted;
        if (restored) delete learner.hpsOriginals[kind][index];
        else origin.applied = adjusted;
      } else if (numeric(previous) && Number(next) < Number(previous) && numeric(value) && Number(value) > Number(next)) {
        learner.hpsOriginals ||= {};
        learner.hpsOriginals[kind] ||= {};
        learner.hpsOriginals[kind][index] = { score: value, hps: previous, applied: String(next) };
        learner[kind][index] = String(next);
        result.capped++;
      }
    });
    return result;
  }

  function normalizeOrigins(learner, lengths) {
    const origins = {};
    kinds.forEach(kind => {
      const entries = learner?.hpsOriginals?.[kind] || {};
      Object.keys(entries).forEach(key => {
        const n = Number(key), v = entries[key];
        if (!Number.isInteger(n) || n < 0 || n >= lengths[kind] || !v || !numeric(v.score) || !numeric(v.hps) || Number(v.hps) <= 0 || !numeric(v.applied)) return;
        if (String(learner[kind]?.[n]) !== String(v.applied)) return;
        origins[kind] ||= {};
        origins[kind][n] = { score: v.score, hps: v.hps, applied: v.applied };
      });
    });
    return origins;
  }

  function completion(period) {
    if (!period?.roster) return { complete: false, filled: 0, expected: 0, learners: 0 };
    const learners = period.roster.filter(l => String(l.name || '').trim() && !category(l.name));
    let filled = 0, expected = 0, configured = true;
    kinds.forEach(kind => {
      const hps = period[kind + 'Hps'] || [];
      if (!hps.length) configured = false;
      // Every visible activity is required. Unused columns must be removed.
      hps.forEach((maximum, index) => {
        const validHps = numeric(maximum) && Number(maximum) > 0;
        if (!validHps) configured = false;
        learners.forEach(learner => {
          expected++;
          const score = learner[kind]?.[index];
          const code = String(score || '').trim().toUpperCase();
          if (validHps && (['A','M','E','L'].includes(code) || (numeric(score) && Number(score) <= Number(maximum)))) filled++;
        });
      });
    });
    // Scores on unnamed rows also prevent a false "finalized" result.
    const orphanScores = period.roster.some(l => !String(l.name || '').trim() && kinds.some(k => (l[k] || []).some(present)));
    return { complete: configured && learners.length > 0 && expected > 0 && filled === expected && !orphanScores, filled, expected, learners: learners.length };
  }

  function periodLabel(period, group, index, calendarMode = 'legacy') {
    if (calendarMode === 'trimester') return period.name || `Term ${period.term || index + 1}`;
    if (group !== 'SHS') return period.name || `Quarter ${index + 1}`;
    if (/semester/i.test(period.name || '')) return period.name;
    const semester = period.semester || Math.floor(index / 2) + 1;
    const quarter = period.quarter || index % 2 + 1;
    return `${period.name || 'Period'} · Quarter ${quarter}, Semester ${semester}`;
  }
  return { setScore, adjustHps, normalizeOrigins, completion, periodLabel };
});
