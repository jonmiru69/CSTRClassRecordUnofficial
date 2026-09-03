/*
 * Pure, DOM-free grading functions for the CSTR Class Record.
 * Display rounding is deliberately kept separate from calculations.
 * Features:
 * - DepEd Order No. 15, s. 2026 / DepEd Order No. 8, s. 2015 Transmutation Engine
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

  // Exact DepEd Transmutation Table (40-tier)
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
    if (value === "" || value === null || value === undefined) return null;
    if (isAttendanceCode(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function roundHalfUp(value, decimals) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** decimals;
    return Math.floor((value * factor) + 0.5 + Number.EPSILON) / factor;
  }

  function format(value, decimals) {
    const rounded = roundHalfUp(value, decimals);
    return rounded === null ? "—" : rounded.toFixed(decimals);
  }

  function matchSubjectWeights(subjectName) {
    if (!subjectName || typeof subjectName !== "string") return [20, 50, 30];
    const clean = subjectName.trim().toLowerCase();
    for (const preset of SUBJECT_PRESETS) {
      if (clean === preset.name.toLowerCase()) return [...preset.weights];
    }
    if (clean.includes("mapeh") || clean.includes("music") || clean.includes("arts") || clean.includes("physical education") || clean.includes("health")) {
      return [20, 60, 20];
    }
    if (clean.includes("epp") || clean.includes("tle") || clean.includes("pangkabuhayan") || clean.includes("livelihood")) {
      return [20, 60, 20];
    }
    return [20, 50, 30];
  }

  function transmuteGrade(initialScore) {
    if (initialScore === null || initialScore === undefined || !Number.isFinite(initialScore)) return null;
    // Round to 2 decimal places to avoid floating point precision artifacts at tier boundaries
    const rounded = Math.round((initialScore + Number.EPSILON) * 100) / 100;
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

  function calculateComponent(rawScores, hpsScores, componentWeight) {
    let rawTotal = 0;
    let hpsTotal = 0;
    let used = 0;

    rawScores.forEach((rawValue, index) => {
      const hps = numberOrNull(hpsScores[index]);
      if (hps === null || hps <= 0) return;
      if (isZeroScoreCode(rawValue)) {
        // Absent / Missing (no excuse): counts as zero against this item's HPS.
        rawTotal += 0;
        hpsTotal += hps;
        used += 1;
        return;
      }
      if (isExcludedCode(rawValue)) return; // Excused / Late: excluded entirely, like a blank slot.
      const raw = numberOrNull(rawValue);
      if (raw === null) return;
      rawTotal += raw;
      hpsTotal += hps;
      used += 1;
    });

    if (!used || hpsTotal <= 0) {
      return { rawTotal, hpsTotal, percentage: null, weighted: null, used };
    }
    const percentage = (rawTotal / hpsTotal) * 100;
    return {
      rawTotal,
      hpsTotal,
      percentage,
      weighted: percentage * (componentWeight / 100),
      used
    };
  }

  // QA Support: Normalized 30 / 30 / 40 weights for 3 slots, or standard component normalization
  function calculateQuarterlyAssessment(rawScores, hpsScores, componentWeight) {
    if (rawScores.length === 3) {
      let weightedPercentage = 0;
      let activeIntraWeight = 0;
      let rawTotal = 0;
      let hpsTotal = 0;
      let used = 0;

      QA_INTRA_WEIGHTS.forEach((intraWeight, index) => {
        const hps = numberOrNull(hpsScores[index]);
        if (hps === null || hps <= 0) return;
        let raw;
        if (isZeroScoreCode(rawScores[index])) {
          raw = 0; // Absent / Missing (no excuse): counts as zero against this item's HPS.
        } else if (isExcludedCode(rawScores[index])) {
          return; // Excused / Late: excluded entirely, like a blank slot.
        } else {
          raw = numberOrNull(rawScores[index]);
          if (raw === null) return;
        }
        weightedPercentage += ((raw / hps) * 100) * intraWeight;
        activeIntraWeight += intraWeight;
        rawTotal += raw;
        hpsTotal += hps;
        used += 1;
      });

      if (!used || activeIntraWeight <= 0) {
        return { rawTotal, hpsTotal, percentage: null, weighted: null, used };
      }
      const percentage = weightedPercentage / activeIntraWeight;
      return { rawTotal, hpsTotal, percentage, weighted: percentage * (componentWeight / 100), used };
    }
    
    return calculateComponent(rawScores, hpsScores, componentWeight);
  }

  function calculateInitialGrade(writtenWork, performanceTask, quarterlyAssessment) {
    const parts = [writtenWork.weighted, performanceTask.weighted, quarterlyAssessment.weighted];
    if (parts.some((value) => !Number.isFinite(value))) return { precise: null, rounded: null, transmuted: null, descriptor: "—" };
    const precise = parts.reduce((sum, value) => sum + value, 0);
    const rounded = roundHalfUp(precise, FINAL_GRADE_DECIMALS);
    const transmuted = transmuteGrade(precise);
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
      passes: ww.weighted === 24 && pt.weighted === 36 && qa.weighted === 25.8 && initial.rounded === 86 && initial.transmuted === 89 && initial.descriptor === "Benchmarking"
    };
  }

  return {
    FINAL_GRADE_DECIMALS,
    QA_INTRA_WEIGHTS,
    ATTENDANCE_CODES,
    ZERO_SCORE_CODES,
    EXCLUDED_CODES,
    SUBJECT_PRESETS,
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
