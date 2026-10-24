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
  function getLearnerCategory(name) {
    // Match whole-word heading labels, including strand/section prefixes.
    // Comma-separated personal names and partial words never become headings.
    const label = String(name || '').normalize('NFKC').trim();
    if (!label || label.includes(',')) return null;
    const match = label.match(/(?:^|[\s:–—\-([/])(boys|girls)(?=$|[\s:–—\-)\]/.!])/gi);
    if (!match) return null;
    const categories = [...new Set(match.map(value => value.match(/boys|girls/i)[0].toLowerCase()))];
    return categories.length === 1 ? categories[0] : null;
  }
  function getRowCategory(learner) {
    const sex = getLearnerCategory(learner?.name);
    if (sex) return sex;
    const label = String(learner?.name || '').normalize('NFKC').trim();
    const heading = /^(STEM|ABM|HUMSS|GAS|TVL|ICT|HE|HUMANITIES|ARTS|SPORTS)(?:[ \-–—/]+[A-Z0-9]{1,12}){0,3}$/.test(label);
    // A scored row is never reclassified merely because its name resembles a section.
    const hasScores = kinds.some(kind => (learner?.[kind] || []).some(present));
    const hasHistory = kinds.some(kind => Object.values(learner?.scoreAdjustments?.[kind] || {}).some(a => a?.entries?.length || a?.history?.length));
    return heading && !hasScores && !hasHistory ? 'section' : null;
  }
  const category = name => getLearnerCategory(name) !== null;

  function setScore(learner, kind, index, value) {
    if (!kinds.includes(kind)) throw new Error('Unknown assessment component');
    // A direct replacement starts a new raw score. Keep the previous explanation
    // as history rather than silently carrying bonus points to a different mark.
    const adjustment = learner.scoreAdjustments?.[kind]?.[index];
    if (adjustment && String(value) !== String(learner[kind][index])) {
      adjustment.history ||= [];
      if (adjustment.entries.length) adjustment.history.push({ raw: adjustment.raw, applied: learner[kind][index], entries: adjustment.entries, endedAt: new Date().toISOString(), reason: 'Score replaced by direct edit' });
      adjustment.entries = [];
      adjustment.raw = value;
    }
    // Every explicit edit wins, even if it equals the temporarily capped score.
    if (learner.hpsOriginals?.[kind]) delete learner.hpsOriginals[kind][index];
    learner[kind][index] = value;
  }

  const precise = n => Math.round((n + Number.EPSILON) * 1e8) / 1e8;
  function addPoints(period, kind, row, index, amount, reason, actor = '') {
    if (period.locked) throw new Error('Unlock this period before adding points.');
    if (!kinds.includes(kind) || !Number.isInteger(index) || index < 0 || index >= period[kind + 'Hps'].length) throw new Error('Unknown activity.');
    const learner = period.roster[row], maximum = period[kind + 'Hps'][index];
    if (!learner || !learner.name.trim() || category(learner.name)) throw new Error('Enter a learner name first.');
    if (!numeric(learner[kind][index])) throw new Error('Enter a numeric raw score first. A, L, M, E and blank marks remain unchanged.');
    if (!numeric(maximum) || Number(maximum) <= 0) throw new Error('Set a valid HPS first.');
    const points = Number(amount), explanation = String(reason || '').trim();
    if (!present(amount) || !Number.isFinite(points) || points <= 0 || precise(points) === 0) throw new Error('Points must be a positive number.');
    if (!explanation || explanation.length > 500) throw new Error('A reason of 1–500 characters is required.');
    const result = precise(Number(learner[kind][index]) + points);
    if (result > Number(maximum)) throw new Error('The resulting score cannot exceed HPS.');
    learner.scoreAdjustments ||= {};
    learner.scoreAdjustments[kind] ||= {};
    const ledger = learner.scoreAdjustments[kind][index] ||= { raw: learner[kind][index], entries: [], history: [] };
    ledger.entries.push({ points: precise(points), reason: explanation, at: new Date().toISOString(), actor: String(actor).slice(0, 200) });
    learner[kind][index] = String(result);
    if (learner.hpsOriginals?.[kind]) delete learner.hpsOriginals[kind][index];
    return result;
  }

  function removePoints(period, kind, row, index, reason) {
    if (period.locked) throw new Error('Unlock this period first.');
    if (!kinds.includes(kind)) throw new Error('Unknown assessment component');
    const learner = period.roster[row], ledger = learner?.scoreAdjustments?.[kind]?.[index];
    if (!ledger?.entries.length) throw new Error('There are no added points to remove.');
    const explanation = String(reason || '').trim();
    if (!explanation || explanation.length > 500) throw new Error('A reason of 1–500 characters is required.');
    ledger.history ||= [];
    ledger.history.push({ raw: ledger.raw, applied: learner[kind][index], entries: ledger.entries, endedAt: new Date().toISOString(), reason: explanation });
    ledger.entries = [];
    const maximum = period[kind + 'Hps'][index], origin = learner.hpsOriginals?.[kind]?.[index];
    learner[kind][index] = numeric(ledger.raw) && numeric(maximum) && Number(maximum) > 0 ? (Number(ledger.raw) > Number(maximum) ? String(maximum) : ledger.raw) : ledger.raw;
    if (numeric(ledger.raw) && numeric(maximum) && Number(maximum) > 0 && Number(ledger.raw) > Number(maximum)) {
      learner.hpsOriginals ||= {}; learner.hpsOriginals[kind] ||= {};
      learner.hpsOriginals[kind][index] = { score: ledger.raw, hps: origin?.hps || ledger.raw, applied: learner[kind][index] };
    } else if (learner.hpsOriginals?.[kind]) delete learner.hpsOriginals[kind][index];
  }

  function normalizeAdjustments(learner, lengths) {
    const result = {};
    const entries = list => (Array.isArray(list) ? list : []).filter(e => e && numeric(e.points) && Number(e.points) > 0 && typeof e.reason === 'string' && e.reason.trim() && e.reason.length <= 500).map(e => ({ points: Number(e.points), reason: e.reason, at: typeof e.at === 'string' ? e.at : '', actor: typeof e.actor === 'string' ? e.actor.slice(0, 200) : '' }));
    kinds.forEach(kind => Object.entries(learner?.scoreAdjustments?.[kind] || {}).forEach(([key, item]) => {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= lengths[kind] || !item || !['string', 'number'].includes(typeof item.raw)) return;
      const history = (Array.isArray(item.history) ? item.history : []).filter(h => h && ['string', 'number'].includes(typeof h.raw)).map(h => ({ raw: h.raw, applied: h.applied ?? '', entries: entries(h.entries), endedAt: typeof h.endedAt === 'string' ? h.endedAt : '', reason: String(h.reason || '').slice(0, 500) }));
      result[kind] ||= {};
      result[kind][index] = { raw: item.raw, entries: entries(item.entries), history };
    }));
    return result;
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
  return { getLearnerCategory, getRowCategory, setScore, addPoints, removePoints, normalizeAdjustments, adjustHps, normalizeOrigins, completion, periodLabel };
});
