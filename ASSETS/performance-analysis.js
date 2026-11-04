(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grading-engine.js'));
  else root.CSTRPerformance = factory(root.CSTRGrading);
})(typeof window === 'object' ? window : globalThis, function (grading) {
  'use strict';

  const kinds = ['ww', 'pt', 'qa'];
  const percent = value => Number.isFinite(value) ? `${grading.format(value, 2)}%` : '—';
  const present = value => String(value ?? '').trim() !== '';
  const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

  function analyze(rows, weights, result, assessmentLabel) {
    const labels = ['Written Works', 'Performance Tasks', assessmentLabel];
    const components = kinds.flatMap((kind, index) => {
      if (!(weights[index] > 0)) return [];
      const component = result[kind];
      return [`${labels[index]} ${percent(component.percentage)} (${weights[index]}% weight)${component.error ? `. ${component.error}` : ''}`];
    });
    const evidence = [], issues = { pending: [], missing: [], absent: [], excused: [], late: [], invalid: [], revised: [], adjusted: [] };

    for (const row of rows) {
      if (!(weights[kinds.indexOf(row.kind)] > 0) || (!present(row.hps) && !present(row.score))) continue;
      const slot = `${row.kind.toUpperCase()} ${row.index + 1}`;
      const title = String(row.meta.title || '').trim();
      const label = title ? `${slot} · ${title}` : slot;
      const hps = grading.numberOrNull(row.hps);
      const mark = String(row.score).trim().toUpperCase();
      if (!(hps > 0)) { issues.invalid.push(label); continue; }
      if (!mark) { issues.pending.push(label); continue; }
      const status = { M: 'missing', A: 'absent', E: 'excused', L: 'late' }[mark];
      if (status) { issues[status].push(label); continue; }
      const effective = grading.numberOrNull(row.score);
      if (effective === null || effective < 0 || effective > hps) { issues.invalid.push(label); continue; }

      const adjusted = Boolean(row.ledger?.entries?.length);
      if (adjusted) issues.adjusted.push(label);
      const source = adjusted ? row.ledger.raw : row.score;
      const score = grading.numberOrNull(source);
      if (row.original || (score !== null && score > hps)) { issues.revised.push(label); continue; }
      if (score === null || score < 0 || score > effective) { issues.invalid.push(label); continue; }

      const percentage = score / hps * 100;
      evidence.push({ label, score, hps, percentage, source: String(source).trim(), maximum: String(row.hps).trim(),
        topic: String(row.meta.topic || row.meta.competency || '').trim(), adjusted });
    }

    const ranked = evidence.slice().sort((a, b) => b.percentage - a.percentage);
    const high = ranked[0], low = ranked.at(-1);
    // Show ties at the same precision the report displays.
    const distinct = high && percent(high.percentage) !== percent(low.percentage);
    const strengths = distinct ? ranked.filter(row => percent(row.percentage) === percent(high.percentage)) : [];
    const gaps = distinct ? ranked.filter(row => percent(row.percentage) === percent(low.percentage)) : [];
    const describe = row => `${row.label} — ${row.source}/${row.maximum} (${percent(row.percentage)}${row.adjusted ? ', before added points' : ''})`;
    const summarize = list => [...list.slice(0, 3).map(describe), ...(list.length > 3 ? [`${list.length - 3} more tied results in the activity record.`] : [])];
    const details = [
      count(evidence.length, 'usable numeric result') + ' for feedback. Rankings use scores before added points.',
      ...Object.entries({ pending: 'pending', missing: 'marked missing', absent: 'marked absent', excused: 'excused',
        late: 'marked late (excluded)', invalid: 'need a score or HPS check', revised: 'excluded from feedback ranking after an HPS revision', adjusted: 'with added points' })
        .filter(([key]) => issues[key].length).map(([key, label]) => `${issues[key].length} ${label}`)
    ];
    const actions = [];
    if (issues.invalid.length || issues.revised.length) actions.push({ kind: 'check', text: 'Ask your teacher to verify the flagged scores or highest possible scores.' });
    if (issues.pending.length) actions.push({ kind: 'pending', text: 'Check with your teacher whether the pending scores have been recorded.' });
    if (issues.missing.length || issues.absent.length) actions.push({ kind: 'catchup', text: 'Ask your teacher which missing or missed activities you can complete.' });
    if (low && low.score < low.hps) actions.push({ kind: 'review', text: low.topic
      ? `Review ${low.topic} using ${low.label}. Correct missed items or ask for a worked example.`
      : `Review the feedback on ${low.label}, correct missed items, and try a similar activity.` });
    if (!actions.length) actions.push(high ? { kind: 'extend', text: 'Try a new activity that applies what you practiced this period.' }
      : { kind: 'evidence', text: 'Review this report with your teacher when graded work is available.' });

    return {
      sections: [
        { title: 'Current performance', lines: [...components, details[0], details.slice(1).join(' · ')].filter(Boolean) },
        { title: 'Strengths', lines: strengths.length ? ['Highest relative results in this period', ...summarize(strengths)]
          : [high && ranked.length === 1 ? `Only one usable result so far. ${describe(high)}`
            : high ? 'Recorded results are tied at the displayed precision.' : 'No usable numeric scores yet.'] },
        { title: 'Areas to improve', lines: gaps.length ? ['Lowest relative results in this period', ...summarize(gaps)]
          : ['The recorded scores do not establish a relative low result.'] },
        { title: 'What to do next', lines: actions.map(action => action.text) }
      ],
      draft: evidence.length || Object.values(issues).some(list => list.length) ? {
        context: { usable: evidence.length, strongest: high?.percentage ?? null, lowest: low?.percentage ?? null,
          issues: Object.fromEntries(Object.entries(issues).map(([key, list]) => [key, list.length])) },
        actions
      } : null
    };
  }

  const language = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  const openings = ['Here is one next step for this grading period.', 'Let’s choose a manageable next step for this grading period.'];

  async function draftFeedback(model, draft, { signal, onDownload }) {
    signal.throwIfAborted();
    const availability = await model.availability(language);
    signal.throwIfAborted();
    if (!['available', 'downloadable', 'downloading'].includes(availability)) return null;
    const session = await model.create({ ...language, signal,
      monitor: monitor => monitor.addEventListener('downloadprogress', event => onDownload(event.loaded)) });
    try {
      const choices = draft.actions.map((action, index) => ({ index, kind: action.kind }));
      const response = await session.prompt(
        `Pick one next step for this learner, and an opening style. Prefer score verification when scores are invalid, catch-up when marked missing or absent, and practice when scores can be reviewed. Style 0 is direct and style 1 is encouraging. Return JSON with action (the index) and style (0 or 1).\n${JSON.stringify({ ...draft.context, choices })}`,
        { signal, responseConstraint: { type: 'object', required: ['action', 'style'], additionalProperties: false,
          properties: { action: { type: 'integer', enum: choices.map(choice => choice.index) }, style: { type: 'integer', enum: [0, 1] } } } });
      signal.throwIfAborted();
      const selection = JSON.parse(response);
      if (!selection || Object.keys(selection).length !== 2 || !Number.isInteger(selection.action) ||
          !choices[selection.action] || ![0, 1].includes(selection.style)) throw new Error('Invalid feedback selection');
      // Assemble the note from verified report text. The model supplies no factual prose.
      return `${openings[selection.style]} ${draft.actions[selection.action].text}`;
    } finally {
      session.destroy();
    }
  }

  return { analyze, draftFeedback };
});
