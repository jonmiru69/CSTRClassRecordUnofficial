/*
 * Pure, DOM-free grading functions for the CSTR Class Record.
 * Display rounding is deliberately kept separate from calculations.
 * Features:
 * - School workbook calculations and DO 015, s. 2026 subject weights
 * - DepEd Table 11 Qualitative Descriptors
 * - Standard DepEd Subject Weighting Presets
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CSTRGrading = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // Keep calculations at full precision. This only controls the displayed
  // Initial Grade, which is rounded half-up to three decimal places.
  const FINAL_GRADE_DECIMALS = 3;
  // Zero-based grading is an explicit class setting, independent of calendar.
  const ZERO_BASED_GRADE_DECIMALS = 0;
  const QA_INTRA_WEIGHTS = [0.30, 0.30, 0.40];
  // A = Absent, E = Excused, L = Late, M = Missing (present, no excuse)
  const ATTENDANCE_CODES = ["A", "E", "L", "M"];
  // Absent and Missing-without-excuse are scored as zero against that item's HPS,
  // so the activity still counts against the learner's cumulative total.
  const ZERO_SCORE_CODES = ["A", "M"];
  // Excused and Late are excluded entirely, as if the activity never happened,
  // so they never unfairly drag down the learner's grade.
  const EXCLUDED_CODES = ["E", "L"];

  // Standard DepEd Subject Weights Catalog
  const SUBJECT_PRESETS = [
    { name: "English", weights: [20, 50, 30], label: "English — WW: 20% | PT: 50% | EX: 30%" },
    { name: "Filipino", weights: [20, 50, 30], label: "Filipino — WW: 20% | PT: 50% | EX: 30%" },
    { name: "Mathematics", weights: [20, 50, 30], label: "Mathematics — WW: 20% | PT: 50% | EX: 30%" },
    { name: "Science", weights: [20, 50, 30], label: "Science — WW: 20% | PT: 50% | EX: 30%" },
    { name: "Araling Panlipunan (AP)", weights: [20, 50, 30], label: "Araling Panlipunan (AP) — WW: 20% | PT: 50% | EX: 30%" },
    { name: "Good Manners and Right Conduct (GMRC) / Values Education (VE)", weights: [20, 50, 30], label: "GMRC / Values Education (VE) — WW: 20% | PT: 50% | EX: 30%" },
    { name: "Edukasyong Pantahanan at Pangkabuhayan (EPP) / Technology and Livelihood Education (TLE)", weights: [20, 60, 20], label: "EPP / TLE — WW: 20% | PT: 60% | EX: 20%" },
    { name: "Music, Arts, Physical Education, and Health (MAPEH)", weights: [20, 60, 20], label: "MAPEH — WW: 20% | PT: 60% | EX: 20%" }
  ];

  const SHS_PRESETS = [
    { name: "SHS Core Subjects / Other Academic Electives", weights: [20, 50, 30] },
    { name: "SHS Field Exposure / Arts Apprenticeship / Creative Production and Innovation", weights: [15, 70, 15], examMode: "te-only" },
    { name: "SHS Arts / Sports / Health and Wellness Electives", weights: [20, 60, 20] },
    { name: "SHS Research Electives / Design and Innovation", weights: [40, 60, 0] },
    { name: "SHS TechPro Electives", weights: [15, 65, 20] },
    { name: "SHS Work Immersion", weights: [20, 80, 0] },
    // DO 015 s.2026 paragraph 49: Grade 12 outside the Strengthened curriculum.
    { name: "SHS Grade 12 Legacy - Core Subjects", weights: [25, 50, 25] },
    { name: "SHS Grade 12 Legacy - Academic Other Subjects", weights: [25, 45, 30] },
    { name: "SHS Grade 12 Legacy - Academic Immersion / Research / Exhibit / Performance", weights: [35, 40, 25] },
    { name: "SHS Grade 12 Legacy - TVL / Sports / Arts and Design", weights: [20, 60, 20] }
  ];
  SHS_PRESETS.forEach(preset => SUBJECT_PRESETS.push({ ...preset,
    label: `${preset.name} — WW: ${preset.weights[0]}% | PT: ${preset.weights[1]}% | EX: ${preset.weights[2]}%`
  }));

  // Annex D, Tables 2 and 3. Roles are explicitly editable in the activity register.
  function subjectRules(subjectName) {
    const name = String(subjectName || "").trim().toLowerCase();
    const preset = SUBJECT_PRESETS.find(item => item.name.toLowerCase() === name);
    const valuesEducation = /\bgmrc\b|values education|good manners/.test(name);
    const teOnly = preset?.examMode === "te-only" || /field exposure|arts apprenticeship|creative production/.test(name);
    return {
      examMode: teOnly ? "te-only" : "st1-st2-te",
      domains: valuesEducation ? {
        ww: [{ id: "cognitive", share: .5 }, { id: "affective", share: .5 }],
        pt: [{ id: "cognitive", share: .2 }, { id: "affective", share: .2 }, { id: "behavioral", share: .6 }]
      } : null
    };
  }

  function defaultRole(kind, index, subjectName) {
    if (kind !== "qa") return "";
    if (subjectRules(subjectName).examMode === "te-only") return "te";
    return ["st1", "st2", "te"][index] || "";
  }

  function gradingIssue(section) {
    const category = section?.gradingCategory || section?.subject || "";
    const preset = SUBJECT_PRESETS.find(item => item.name === category);
    if (preset && section.weights.some((weight,index)=>Math.abs(weight-preset.weights[index])>1e-8)) return `The selected ${preset.name} category requires WW/PT/EX ${preset.weights.join("/")}%. Update the class settings.`;
    if (section?.group === "SHS" && category !== "custom" && (!preset || !category.startsWith("SHS "))) return "Choose the SHS subject category in Edit Class. Core, specialized, Research and Work Immersion have different rules. Grade 12 outside the Strengthened curriculum has separate legacy categories.";
    if (section?.group === "JHS" && category.startsWith("SHS ")) return "Choose a JHS subject category for this class. SHS categories have different grading requirements.";
    return "";
  }

  function componentOptions(section, period, kind) {
    const rules = subjectRules(section?.gradingCategory || section?.subject);
    const groups = kind === "qa"
      ? rules.examMode === "te-only" ? [{ id: "te", share: 1 }]
        : [{ id: "st1", share: .3 }, { id: "st2", share: .3 }, { id: "te", share: .4 }]
      : rules.domains?.[kind];
    return { groups, roles: (period?.[kind + "Hps"] || []).map((_, index) =>
      period?.activityMeta?.[kind]?.[index]?.role || defaultRole(kind, index, section?.gradingCategory || section?.subject)) };
  }

  // Exact DepEd Transmutation Table (41 grade values, 60 through 100)
  const TRANSMUTATION_TABLE = [
    { min: 99.50, max: 100.00, grade: 100 },
    { min: 98.32, max: 99.49,  grade: 99 },
    { min: 97.14, max: 98.31,  grade: 98 },
    { min: 95.96, max: 97.13,  grade: 97 },
    { min: 94.78, max: 95.95,  grade: 96 },
    { min: 93.60, max: 94.77,  grade: 95 },
    { min: 92.42, max: 93.59,  grade: 94 },
    { min: 91.24, max: 92.41,  grade: 93 },
    { min: 90.06, max: 91.23,  grade: 92 },
    { min: 88.88, max: 90.05,  grade: 91 },
    { min: 87.70, max: 88.87,  grade: 90 },
    { min: 86.52, max: 87.69,  grade: 89 },
    { min: 85.34, max: 86.51,  grade: 88 },
    { min: 84.16, max: 85.33,  grade: 87 },
    { min: 82.98, max: 84.15,  grade: 86 },
    { min: 81.80, max: 82.97,  grade: 85 },
    { min: 80.62, max: 81.79,  grade: 84 },
    { min: 79.44, max: 80.61,  grade: 83 },
    { min: 78.26, max: 79.43,  grade: 82 },
    { min: 77.08, max: 78.25,  grade: 81 },
    { min: 75.90, max: 77.07,  grade: 80 },
    { min: 74.72, max: 75.89,  grade: 79 },
    { min: 73.54, max: 74.71,  grade: 78 },
    { min: 72.36, max: 73.53,  grade: 77 },
    { min: 71.18, max: 72.35,  grade: 76 },
    { min: 70.00, max: 71.17,  grade: 75 },
    { min: 65.34, max: 69.99,  grade: 74 },
    { min: 60.67, max: 65.33,  grade: 73 },
    { min: 56.01, max: 60.66,  grade: 72 },
    { min: 51.34, max: 56.00,  grade: 71 },
    { min: 46.67, max: 51.33,  grade: 70 },
    { min: 42.01, max: 46.66,  grade: 69 },
    { min: 37.34, max: 42.00,  grade: 68 },
    { min: 32.68, max: 37.33,  grade: 67 },
    { min: 28.01, max: 32.67,  grade: 66 },
    { min: 23.35, max: 28.00,  grade: 65 },
    { min: 18.68, max: 23.34,  grade: 64 },
    { min: 14.01, max: 18.67,  grade: 63 },
    { min: 9.35,  max: 14.00,  grade: 62 },
    { min: 4.68,  max: 9.34,   grade: 61 },
    { min: 0.00,  max: 4.67,   grade: 60 }
  ];

  function normalizedCode(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().toUpperCase();
    return ATTENDANCE_CODES.includes(trimmed) ? trimmed : null;
  }

  function isAttendanceCode(value) {
    return normalizedCode(value) !== null;
  }

  function isZeroScoreCode(value) {
    const code = normalizedCode(value);
    return code !== null && ZERO_SCORE_CODES.includes(code);
  }

  function isExcludedCode(value) {
    const code = normalizedCode(value);
    return code !== null && EXCLUDED_CODES.includes(code);
  }

  function numberOrNull(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !value.trim()) return null;
    if (isAttendanceCode(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function roundHalfUp(value, decimals) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** decimals;
    const scaled = value * factor;
    return Math.floor(scaled + 0.5 + Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2) / factor;
  }

  function format(value, decimals) {
    const rounded = roundHalfUp(value, decimals);
    return rounded === null ? "—" : rounded.toFixed(decimals);
  }

  function matchSubjectWeights(subjectName) {
    const clean = String(subjectName || "").trim().toLowerCase();
    const preset = SUBJECT_PRESETS.find(item => clean === item.name.toLowerCase());
    if (preset) return [...preset.weights];
    // Word boundaries avoid matches such as “Research Methods” becoming MAPEH.
    if (/\bwork immersion\b/.test(clean)) return [20, 80, 0];
    if (/\bresearch\b|design and innovation/.test(clean)) return [40, 60, 0];
    if (/field exposure|arts apprenticeship|creative production/.test(clean)) return [15, 70, 15];
    if (/\btechpro\b/.test(clean)) return [15, 65, 20];
    if (/\bmapeh\b|\bmusic\b|\barts\b|physical education|\bhealth\b|\bsports\b/.test(clean)) return [20, 60, 20];
    if (/\bepp\b|\btle\b|pangkabuhayan|livelihood/.test(clean)) return [20, 60, 20];
    return [20, 50, 30];
  }

  function transmuteGrade(initialScore) {
    if (initialScore === null || initialScore === undefined || !Number.isFinite(initialScore)) return null;
    // Remove only binary arithmetic noise at 12 decimal places. Never use
    // the displayed 2/3 decimals to promote an IG below the published cutoff.
    const rounded = Math.round(initialScore * 1e12) / 1e12;
    for (const entry of TRANSMUTATION_TABLE) {
      if (rounded >= entry.min) return entry.grade;
    }
    return 60;
  }

  function getGradeDescriptor(grade) {
    if (grade === null || grade === undefined || !Number.isFinite(grade)) return "—";
    if (grade >= 90) return "Advancing";
    if (grade >= 80) return "Benchmarking";
    if (grade >= 75) return "Connecting";
    if (grade >= 65) return "Developing";
    return "Emerging";
  }

  const blank = value => value === null || value === undefined || (typeof value === "string" && !value.trim());
  function calculateComponent(rawScores, hpsScores, componentWeight, options) {
    if (componentWeight === 0) return { rawTotal: 0, hpsTotal: 0, percentage: null, weighted: 0, used: 0, missing: 0 };
    const groups = options?.groups || [{ id: "all", share: 1 }];
    const buckets = groups.map(group => ({ ...group, raw: 0, hps: 0, configured: 0 }));
    let rawTotal = 0, hpsTotal = 0, used = 0, missing = 0, error = null;
    hpsScores.forEach((hpsValue, index) => {
      const rawValue = rawScores[index], hps = numberOrNull(hpsValue);
      if (blank(hpsValue) && blank(rawValue)) return; // Unused activity column.
      if (hps === null || hps <= 0) { error = "Set a positive HPS for every active activity."; return; }
      const role = options?.groups ? options.roles?.[index] : "all";
      const bucket = buckets.find(group => group.id === role);
      if (!bucket) { error = "Assign the assessment group or domain for every active activity."; return; }
      bucket.configured++;
      if (isExcludedCode(rawValue)) return; // E/L remove this activity only for this learner.
      let raw = isZeroScoreCode(rawValue) || blank(rawValue) ? 0 : numberOrNull(rawValue);
      if (raw === null || raw < 0 || raw > hps) { error = "Scores must be between zero and HPS."; return; }
      if (blank(rawValue)) missing++;
      bucket.raw += raw; bucket.hps += hps;
      rawTotal += raw; hpsTotal += hps; used++;
    });
    // Do not silently change 30/30/40 into a uniform or partial exam calculation.
    if (buckets.some(group => !group.configured)) error ||= "Configure HPS for every required assessment group or domain.";
    if (error || !used || hpsTotal <= 0) return { rawTotal, hpsTotal, percentage: null, weighted: null, used, missing, error };
    const active = buckets.filter(group => group.hps > 0);
    const activeShare = active.reduce((sum, group) => sum + group.share, 0);
    const percentage = active.reduce((sum, group) => sum + group.raw / group.hps * 100 * group.share, 0) / activeShare;
    return { rawTotal, hpsTotal, percentage, weighted: percentage * componentWeight / 100, used, missing,
      groups: buckets.map(group => ({ ...group, percentage: group.hps > 0 ? group.raw / group.hps * 100 : null })) };
  }

  function calculateQuarterlyAssessment(rawScores, hpsScores, componentWeight, options) {
    const settings = options || { groups: [{ id: "st1", share: .3 }, { id: "st2", share: .3 }, { id: "te", share: .4 }], roles: rawScores.map((_, index) => defaultRole("qa", index)) };
    return calculateComponent(rawScores, hpsScores, componentWeight, settings);
  }

  function calculateLearner(learner, period, section) {
    const ww = calculateComponent(learner.ww, period.wwHps, section.weights[0], componentOptions(section, period, "ww"));
    const pt = calculateComponent(learner.pt, period.ptHps, section.weights[1], componentOptions(section, period, "pt"));
    const qa = calculateQuarterlyAssessment(learner.qa, period.qaHps, section.weights[2], componentOptions(section, period, "qa"));
    const issue = gradingIssue(section);
    const initial = issue ? { precise: null, rounded: null, transmuted: null, descriptor: "—", error: issue } : calculateInitialGrade(ww, pt, qa, { transmute: section.gradingMode !== "zero-based" });
    return { ww, pt, qa, initial };
  }

  function calculateInitialGrade(writtenWork, performanceTask, quarterlyAssessment, options) {
    const { transmute = true } = options || {};
    const parts = [writtenWork.weighted, performanceTask.weighted, quarterlyAssessment.weighted];
    if (parts.some((value) => !Number.isFinite(value))) return { precise: null, rounded: null, transmuted: null, descriptor: "—" };
    const precise = parts.reduce((sum, value) => sum + value, 0);
    const rounded = roundHalfUp(precise, FINAL_GRADE_DECIMALS);
    const transmuted = transmute ? transmuteGrade(precise) : roundHalfUp(Math.round(precise * 1e12) / 1e12, ZERO_BASED_GRADE_DECIMALS);
    const descriptor = getGradeDescriptor(transmuted);
    return { precise, rounded, transmuted, descriptor };
  }

  function hasRawAboveHps(raw, hps) {
    const rawNumber = numberOrNull(raw);
    const hpsNumber = numberOrNull(hps);
    return rawNumber !== null && hpsNumber !== null && rawNumber > hpsNumber;
  }

  function workedExample() {
    const ww = calculateComponent([8, 9, 7], [10, 10, 10], 30);
    const pt = calculateComponent([18, 17, 19], [20, 20, 20], 40);
    const qa = calculateQuarterlyAssessment([27, 24, 35], [30, 30, 40], 30);
    const initial = calculateInitialGrade(ww, pt, qa);
    return {
      ww, pt, qa, initial,
      // 24 + 36 + 25.8 = 85.8. Keep this example aligned with the same
      // precision and transmutation path used by the live class sheet.
      passes: ww.weighted === 24 && pt.weighted === 36 && qa.weighted === 25.8 && initial.rounded === 85.8 && initial.transmuted === 88 && initial.descriptor === "Benchmarking"
    };
  }

  return {
    FINAL_GRADE_DECIMALS,
    QA_INTRA_WEIGHTS,
    ATTENDANCE_CODES,
    ZERO_SCORE_CODES,
    EXCLUDED_CODES,
    SUBJECT_PRESETS,
    SHS_PRESETS,
    subjectRules,
    defaultRole,
    componentOptions,
    gradingIssue,
    calculateLearner,
    TRANSMUTATION_TABLE,
    numberOrNull,
    roundHalfUp,
    format,
    matchSubjectWeights,
    transmuteGrade,
    getGradeDescriptor,
    calculateComponent,
    calculateQuarterlyAssessment,
    calculateInitialGrade,
    hasRawAboveHps,
    isAttendanceCode,
    isZeroScoreCode,
    isExcludedCode,
    workedExample
  };
});
