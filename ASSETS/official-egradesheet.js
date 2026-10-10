(function (root, factory) {
  "use strict";
  root.CSTROfficialGradesheet = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const GRID_TOP = 53.5;
  const GRID_BOTTOM = 741.5;
  const GRID_STEP = 13;
  const ROW_HEIGHT = 13;
  const FIRST_DATA_TOP = 229.5;
  const CONTINUATION_DATA_TOP = 53.5;
  const FIRST_PAGE_CAPACITY = 38;
  const CONTINUATION_CAPACITY = 52;
  const FINAL_PAGE_CAPACITY = 12;
  const MINIMUM_OFFICIAL_ROWS = 40;
  const COLUMN_X = [49.5, 145, 200.5, 262, 331, 408.5, 458, 522.5, 561.5];

  function xmlEscape(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;"
    })[character]);
  }

  function cleanText(value) {
    return String(value === null || value === undefined ? "" : value).replace(/\s+/g, " ").trim();
  }

  function finiteNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function fixedOrBlank(value, decimals) {
    const number = finiteNumber(value);
    return number === null ? "" : number.toFixed(decimals);
  }

  function integerOrBlank(value) {
    const number = finiteNumber(value);
    return number === null ? "" : String(Math.round(number));
  }

  function safeFilePart(value) {
    return cleanText(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70);
  }

  function officialFilename(payload, extension) {
    const parts = [
      "Official-E-Gradesheet",
      payload.level,
      payload.subject,
      payload.section,
      payload.schoolYear
    ].map(safeFilePart).filter(Boolean);
    return `${parts.join("-") || "Official-E-Gradesheet"}.${extension}`;
  }

  function svgText(x, y, value, options) {
    const settings = Object.assign({
      size: 9,
      family: "Arial, Helvetica, sans-serif",
      weight: 400,
      style: "normal",
      anchor: "start",
      fill: "#000000",
      letterSpacing: 0
    }, options || {});
    const attrs = [
      `x="${x}"`,
      `y="${y}"`,
      `font-family="${xmlEscape(settings.family)}"`,
      `font-size="${settings.size}"`,
      `font-weight="${settings.weight}"`,
      `font-style="${settings.style}"`,
      `text-anchor="${settings.anchor}"`,
      `fill="${settings.fill}"`,
      `letter-spacing="${settings.letterSpacing}"`
    ];
    return `<text ${attrs.join(" ")}>${xmlEscape(value)}</text>`;
  }

  function svgLine(x1, y1, x2, y2, options) {
    const settings = Object.assign({ stroke: "#000000", width: 0.55 }, options || {});
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${settings.stroke}" stroke-width="${settings.width}" shape-rendering="crispEdges"/>`;
  }

  function svgRect(x, y, width, height, options) {
    const settings = Object.assign({ fill: "none", stroke: "#000000", strokeWidth: 0.55 }, options || {});
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${settings.fill}" stroke="${settings.stroke}" stroke-width="${settings.strokeWidth}" shape-rendering="crispEdges"/>`;
  }

  function baseGridSvg() {
    const lines = [];
    COLUMN_X.forEach((x) => lines.push(svgLine(x, GRID_TOP, x, GRID_BOTTOM, { stroke: "#d7d7d7", width: 0.45 })));
    for (let y = GRID_TOP; y <= GRID_BOTTOM + 0.1; y += GRID_STEP) {
      lines.push(svgLine(COLUMN_X[0], y, COLUMN_X[COLUMN_X.length - 1], y, { stroke: "#d7d7d7", width: 0.45 }));
    }
    return lines.join("");
  }

  function whiteBand(y, height, left, right) {
    return `<rect x="${left}" y="${y}" width="${right - left}" height="${height}" fill="#ffffff"/>`;
  }

  function splitLines(value, maximumCharacters) {
    const words = cleanText(value).split(" ").filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maximumCharacters || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }

  function multiLineText(x, centerY, lines, options) {
    const settings = Object.assign({ lineHeight: 10, size: 9 }, options || {});
    if (!lines.length) return "";
    const firstBaseline = centerY - ((lines.length - 1) * settings.lineHeight) / 2 + settings.size * 0.34;
    return lines.map((line, index) => svgText(x, firstBaseline + index * settings.lineHeight, line, settings)).join("");
  }

  function gradeAndSection(payload) {
    const level = cleanText(payload.level).replace(/^grade\s+/i, "");
    const section = cleanText(payload.section);
    if (level && section) return `${level}- ${section}`;
    return section || level;
  }

  function firstPageHeadingSvg(payload) {
    const left = COLUMN_X[0];
    const right = COLUMN_X[COLUMN_X.length - 1];
    const dataRight = COLUMN_X[7];
    const pieces = [];

    pieces.push(whiteBand(53.5, 136.5, left, right));
    for (let y = 53.5; y <= 190; y += GRID_STEP) {
      pieces.push(svgLine(left, y, right, y, { stroke: "#d7d7d7", width: 0.45 }));
    }
    COLUMN_X.forEach((x) => pieces.push(svgLine(x, 53.5, x, 190, { stroke: "#d7d7d7", width: 0.45 })));

    pieces.push(svgText(left + 2, 61.5, "CST-R FORM 1", { size: 6.6 }));
    pieces.push(svgText((left + right) / 2, 101.5, "COLEGIO DE STO.TOMAS-RECOLETOS, INC.", {
      size: 21.5,
      family: "Times New Roman, Times, serif",
      anchor: "middle"
    }));
    pieces.push(svgText((left + right) / 2, 118.5, "Azcona St., San Carlos City, Negros Occidental", {
      size: 9.2,
      anchor: "middle"
    }));
    pieces.push(svgText((left + right) / 2, 146.5, `REPORT ON RATINGS S.Y. ${cleanText(payload.schoolYear)}`, {
      size: 13.1,
      anchor: "middle"
    }));

    const yearSection = gradeAndSection(payload);
    pieces.push(svgText(107, 175.2, "YEAR & SECTION:", { size: 9.4, weight: 700 }));
    pieces.push(svgText(200, 175.2, yearSection, { size: 9.4, weight: 700 }));
    pieces.push(svgText(374.5, 175.2, "SUBJECT:", { size: 9.4, weight: 700 }));
    pieces.push(svgText(421.5, 175.2, cleanText(payload.subject), { size: 9.4, weight: 700 }));
    const subjectWidth = Math.min(98, Math.max(24, cleanText(payload.subject).length * 5.5));
    pieces.push(svgLine(421.5, 177.5, 421.5 + subjectWidth, 177.5, { width: 0.65 }));

    pieces.push(svgRect(left, 190, dataRight - left, 39.5, { fill: "#ffffff", stroke: "#000000", strokeWidth: 0.6 }));
    for (let index = 1; index <= 7; index += 1) {
      pieces.push(svgLine(COLUMN_X[index], 190, COLUMN_X[index], 229.5, { width: 0.6 }));
    }
    pieces.push(svgLine(COLUMN_X[1], 216.5, dataRight, 216.5, { width: 0.6 }));

    pieces.push(svgText(left + 2, 211.3, "NAMES", { size: 7.5 }));
    pieces.push(svgText((COLUMN_X[1] + COLUMN_X[2]) / 2, 203.5, payload.periodCount === 3 ? "TERM" : "PERIOD", { size: 7.5, weight: 700, anchor: "middle" }));
    pieces.push(multiLineText((COLUMN_X[2] + COLUMN_X[3]) / 2, 202.5, ["Written", `Works (${payload.weights[0]}%)`], {
      size: 8.5,
      lineHeight: 10,
      family: "Times New Roman, Times, serif",
      weight: 700,
      anchor: "middle"
    }));
    pieces.push(multiLineText((COLUMN_X[3] + COLUMN_X[4]) / 2, 202.5, ["Performance", `Task (${payload.weights[1]}%)`], {
      size: 8.5,
      lineHeight: 10,
      family: "Times New Roman, Times, serif",
      weight: 700,
      anchor: "middle"
    }));
    pieces.push(multiLineText((COLUMN_X[4] + COLUMN_X[5]) / 2, 202.5, [payload.periodCount === 3 ? "Term Asses." : "Quarterly Asses.", `(${payload.weights[2]}%)`], {
      size: 8.5,
      lineHeight: 10,
      family: "Times New Roman, Times, serif",
      weight: 700,
      anchor: "middle"
    }));
    pieces.push(multiLineText((COLUMN_X[5] + COLUMN_X[6]) / 2, 202.5, ["Initial", "Grade"], {
      size: 8.5,
      lineHeight: 10,
      family: "Times New Roman, Times, serif",
      weight: 700,
      anchor: "middle"
    }));
    pieces.push(multiLineText((COLUMN_X[6] + COLUMN_X[7]) / 2, 202.5, [payload.periodCount === 3 ? "Term" : "Periodical", "Grade"], {
      size: 8.5,
      lineHeight: 10,
      family: "Times New Roman, Times, serif",
      weight: 700,
      anchor: "middle"
    }));

    return pieces.join("");
  }

  function normalizeStudent(student, periodCount) {
    const sourcePeriods = Array.isArray(student && student.periods) ? student.periods : [];
    const periods = Array.from({ length: periodCount }, (_, index) => {
      const period = sourcePeriods[index] || {};
      return {
        ww: finiteNumber(period.ww),
        pt: finiteNumber(period.pt),
        qa: finiteNumber(period.qa),
        initial: finiteNumber(period.initial),
        periodical: finiteNumber(period.periodical)
      };
    });
    return {
      name: cleanText(student && student.name),
      periods,
      finalGrade: finiteNumber(student && student.finalGrade)
    };
  }

  function flattenRows(payload) {
    const periodCount = payload.periodCount;
    const students = (Array.isArray(payload.students) ? payload.students : []).map((student) => normalizeStudent(student, periodCount));
    const targetCount = Math.max(MINIMUM_OFFICIAL_ROWS, students.length);
    while (students.length < targetCount) students.push(normalizeStudent({}, periodCount));
    const rows = [];
    students.forEach((student, studentIndex) => {
      for (let rowInStudent = 0; rowInStudent < periodCount + 1; rowInStudent += 1) {
        const period = rowInStudent < periodCount ? student.periods[rowInStudent] : null;
        rows.push({
          student,
          studentIndex,
          rowInStudent,
          finalRow: rowInStudent === periodCount,
          periodLabel: rowInStudent < periodCount ? String(rowInStudent + 1) : "F",
          ww: period ? fixedOrBlank(period.ww, 2) : "",
          pt: period ? fixedOrBlank(period.pt, 2) : "",
          qa: period ? fixedOrBlank(period.qa, 2) : "",
          initial: period ? fixedOrBlank(period.initial, 2) : "",
          periodical: period ? integerOrBlank(period.periodical) : integerOrBlank(student.finalGrade)
        });
      }
    });
    return rows;
  }

  function paginateRows(rows) {
    const pages = [];
    let offset = 0;
    pages.push({ rows: rows.slice(offset, offset + FIRST_PAGE_CAPACITY), first: true, start: offset });
    offset += FIRST_PAGE_CAPACITY;
    let remaining = rows.length - offset;

    while (remaining > CONTINUATION_CAPACITY + FINAL_PAGE_CAPACITY) {
      pages.push({ rows: rows.slice(offset, offset + CONTINUATION_CAPACITY), first: false, start: offset });
      offset += CONTINUATION_CAPACITY;
      remaining = rows.length - offset;
    }
    if (remaining > FINAL_PAGE_CAPACITY) {
      const count = remaining - FINAL_PAGE_CAPACITY;
      pages.push({ rows: rows.slice(offset, offset + count), first: false, start: offset });
      offset += count;
      remaining = rows.length - offset;
    }
    if (remaining > 0) pages.push({ rows: rows.slice(offset), first: false, start: offset });
    pages[pages.length - 1].final = true;
    return pages;
  }

  function studentNameSvg(rowSlice, yTop) {
    const pieces = [];
    let index = 0;
    while (index < rowSlice.length) {
      const row = rowSlice[index];
      const studentIndex = row.studentIndex;
      let end = index + 1;
      while (end < rowSlice.length && rowSlice[end].studentIndex === studentIndex) end += 1;
      const fragmentHeight = (end - index) * ROW_HEIGHT;
      const segmentY = yTop + index * ROW_HEIGHT;
      const name = row.student.name;
      if (name && row.rowInStudent === 0) {
        const numberedName = `${studentIndex + 1}. ${name}`;
        const lines = splitLines(numberedName, 23);
        pieces.push(multiLineText(COLUMN_X[0] + 2.5, segmentY + fragmentHeight / 2, lines, {
          size: 8.5,
          lineHeight: 9.2,
          family: "Times New Roman, Times, serif"
        }));
      }
      index = end;
    }
    return pieces.join("");
  }

  function dataTableSvg(rowSlice, yTop) {
    if (!rowSlice.length) return "";
    const pieces = [];
    const tableBottom = yTop + rowSlice.length * ROW_HEIGHT;
    pieces.push(`<rect x="${COLUMN_X[0]}" y="${yTop}" width="${COLUMN_X[7] - COLUMN_X[0]}" height="${tableBottom - yTop}" fill="#ffffff"/>`);
    for (let index = 0; index <= 7; index += 1) {
      pieces.push(svgLine(COLUMN_X[index], yTop, COLUMN_X[index], tableBottom, { width: 0.6 }));
    }
    pieces.push(svgLine(COLUMN_X[0], yTop, COLUMN_X[7], yTop, { width: 0.6 }));

    rowSlice.forEach((row, index) => {
      const rowTop = yTop + index * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      const fullBoundary = row.finalRow || index === rowSlice.length - 1;
      pieces.push(svgLine(fullBoundary ? COLUMN_X[0] : COLUMN_X[1], rowBottom, COLUMN_X[7], rowBottom, { width: 0.6 }));

      const baseline = rowTop + 9.6;
      pieces.push(svgText((COLUMN_X[1] + COLUMN_X[2]) / 2, baseline, row.periodLabel, {
        size: 8.7,
        family: "Times New Roman, Times, serif",
        weight: 700,
        anchor: "middle"
      }));
      const values = [row.ww, row.pt, row.qa, row.initial, row.periodical];
      values.forEach((value, valueIndex) => {
        if (!value) return;
        pieces.push(svgText((COLUMN_X[valueIndex + 2] + COLUMN_X[valueIndex + 3]) / 2, baseline, value, {
          size: 8.7,
          weight: row.finalRow && valueIndex === 4 ? 700 : 400,
          anchor: "middle"
        }));
      });
    });
    pieces.push(studentNameSvg(rowSlice, yTop));
    return pieces.join("");
  }

  function signatureBlockSvg(payload, tableBottom) {
    const pieces = [];
    const top = Math.max(tableBottom + 13, 228.5);
    const left = COLUMN_X[0];
    const right = COLUMN_X[7];
    const middle = 331;
    const principal = cleanText(payload.principalName);
    const teacher = cleanText(payload.teacherName);

    pieces.push(svgText(left + 2, top + 8.5, "SUBMITTED TO / CHECKED BY:", { size: 7.4, weight: 700 }));
    pieces.push(svgText(left + 2, top + 38.5, principal, { size: 8.4, weight: 700 }));
    pieces.push(svgText((middle + right) / 2, top + 38.5, teacher, { size: 8.4, weight: 700, anchor: "middle" }));
    pieces.push(svgText(left + 2, top + 52.5, "School Principal", {
      size: 8,
      family: "Times New Roman, Times, serif",
      style: "italic"
    }));
    pieces.push(svgText((middle + right) / 2, top + 52.5, "( Subject Teacher's Signature Over Printed Name)", {
      size: 7.5,
      weight: 700,
      anchor: "middle"
    }));

    if (payload.periodCount === 3) {
      [left + 2, middle + 2].forEach((columnLeft) => {
        pieces.push(svgText(columnLeft, top + 79, "1st __________________", { size: 7.5 }));
        pieces.push(svgText(columnLeft, top + 94, "2nd __________________", { size: 7.5 }));
        pieces.push(svgText(columnLeft, top + 109, "3rd __________________", { size: 7.5 }));
      });
      return pieces.join("");
    }
    const leftFirst = "1st __________________";
    const leftSecond = "2nd __________________";
    const rightFirst = "1st __________________";
    const rightSecond = "2nd __________________";
    pieces.push(svgText(left + 2, top + 79, leftFirst, { size: 7.5 }));
    pieces.push(svgText(145.5, top + 79, "3rd __________________", { size: 7.5 }));
    pieces.push(svgText(left + 2, top + 94, leftSecond, { size: 7.5 }));
    pieces.push(svgText(145.5, top + 94, "4th __________________", { size: 7.5 }));
    pieces.push(svgText(middle + 2, top + 79, rightFirst, { size: 7.5 }));
    pieces.push(svgText(408.5, top + 79, "3rd __________________", { size: 7.5 }));
    pieces.push(svgText(middle + 2, top + 94, rightSecond, { size: 7.5 }));
    pieces.push(svgText(408.5, top + 94, "4th __________________", { size: 7.5 }));
    return pieces.join("");
  }

  function normalizePayload(payload) {
    const weights = Array.isArray(payload && payload.weights) ? payload.weights.map(Number) : [20, 50, 30];
    return {
      periodCount: payload && payload.periodCount === 3 ? 3 : 4,
      schoolYear: cleanText(payload && payload.schoolYear),
      level: cleanText(payload && payload.level),
      section: cleanText(payload && payload.section),
      subject: cleanText(payload && payload.subject),
      teacherName: cleanText(payload && payload.teacherName),
      principalName: cleanText(payload && payload.principalName),
      weights: [
        Number.isFinite(weights[0]) ? weights[0] : 20,
        Number.isFinite(weights[1]) ? weights[1] : 50,
        Number.isFinite(weights[2]) ? weights[2] : 30
      ],
      students: Array.isArray(payload && payload.students) ? payload.students : []
    };
  }

  function renderPages(rawPayload) {
    const payload = normalizePayload(rawPayload || {});
    const rows = flattenRows(payload);
    const pages = paginateRows(rows);
    return pages.map((page) => {
      const dataTop = page.first ? FIRST_DATA_TOP : CONTINUATION_DATA_TOP;
      const tableBottom = dataTop + page.rows.length * ROW_HEIGHT;
      const body = [
        `<rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>`,
        baseGridSvg(),
        page.first ? firstPageHeadingSvg(payload) : "",
        dataTableSvg(page.rows, dataTop),
        page.final ? signatureBlockSvg(payload, tableBottom) : ""
      ].join("");
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">${body}</svg>`;
    });
  }

  function blobFromCanvas(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not render the official gradesheet page."));
      }, "image/png");
    });
  }

  async function svgToPngBytes(svg, scale) {
    if (typeof document === "undefined") throw new Error("A browser is required to render the official gradesheet.");
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(source);
    try {
      const image = new Image();
      image.decoding = "sync";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("The official gradesheet page could not be drawn."));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(PAGE_WIDTH * scale);
      canvas.height = Math.round(PAGE_HEIGHT * scale);
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await blobFromCanvas(canvas);
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function pagePngs(payload) {
    const pages = renderPages(payload);
    const pngs = [];
    for (const page of pages) pngs.push(await svgToPngBytes(page, 2));
    return pngs;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { filename, delivery: "browser-download-requested" };
  }

  async function createPdf(rawPayload) {
    if (!root.PDFLib?.PDFDocument) throw new Error("The PDF export library is unavailable.");
    const payload = normalizePayload(rawPayload || {});
    const api = root.PDFLib;
    const pdf = await api.PDFDocument.create();
    if (!root.fontkit) throw new Error("The PDF font library is unavailable. Refresh and retry.");
    pdf.registerFontkit(root.fontkit);
    const fonts = await Promise.all(['NimbusSans-Regular', 'NimbusSans-Bold', 'NimbusRoman-Regular', 'NimbusRoman-Bold', 'NimbusRoman-Italic'].map(async name => {
      const response = await fetch(new URL(`ASSETS/fonts/${name}.otf`, document.baseURI));
      if (!response.ok) throw new Error(`Could not load PDF font ${name}.`);
      return pdf.embedFont(await response.arrayBuffer(), { subset: true });
    }));
    const color = hex => { const value = hex.replace('#', ''); return api.rgb(parseInt(value.slice(0,2),16)/255, parseInt(value.slice(2,4),16)/255, parseInt(value.slice(4,6),16)/255); };
    const pages = renderPages(payload);
    pdf.setTitle(`Official E-Gradesheet - ${payload.subject}`);
    pdf.setAuthor(payload.teacherName || "CSTR Class Record");
    for (const svg of pages) {
      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const documentSvg = new DOMParser().parseFromString(svg, 'image/svg+xml');
      for (const node of documentSvg.documentElement.children) {
        const get = (key, fallback = 0) => Number(node.getAttribute(key) || fallback);
        if (node.tagName === 'rect') {
          const fill = node.getAttribute('fill'), stroke = node.getAttribute('stroke');
          page.drawRectangle({ x: get('x'), y: PAGE_HEIGHT-get('y')-get('height'), width: get('width'), height: get('height'),
            ...(fill && fill !== 'none' ? { color: color(fill) } : { opacity: 0 }),
            ...(stroke && stroke !== 'none' ? { borderColor: color(stroke), borderWidth: get('stroke-width', .55), borderOpacity: 1 } : { borderWidth: 0 }) });
        } else if (node.tagName === 'line') {
          page.drawLine({ start: { x: get('x1'), y: PAGE_HEIGHT-get('y1') }, end: { x: get('x2'), y: PAGE_HEIGHT-get('y2') }, thickness: get('stroke-width', .55), color: color(node.getAttribute('stroke') || '#000000') });
        } else if (node.tagName === 'text') {
          const serif = (node.getAttribute('font-family') || '').includes('Times');
          const bold = get('font-weight', 400) >= 600, italic = node.getAttribute('font-style') === 'italic';
          const font = fonts[serif ? italic ? 4 : bold ? 3 : 2 : bold ? 1 : 0];
          const text = node.textContent;
          let size = get('font-size', 9), x = get('x');
          const anchor = node.getAttribute('text-anchor');
          // Fit metadata into its actual allotted space; retain selectable text.
          let maxWidth = anchor === 'middle' ? Math.min(x - 35, PAGE_WIDTH - 35 - x) * 2 : PAGE_WIDTH - 45 - x;
          if (x === 200) maxWidth = 167;
          if (x === 421.5) maxWidth = 98;
          const measured = font.widthOfTextAtSize(text, size);
          if (measured > maxWidth) size *= maxWidth / measured;
          const width = font.widthOfTextAtSize(text, size);
          if (anchor === 'middle') x -= width / 2;
          else if (anchor === 'end') x -= width;
          page.drawText(text, { x, y: PAGE_HEIGHT-get('y'), font, size, color: color(node.getAttribute('fill') || '#000000') });
        }
      }
    }
    const bytes = await pdf.save({ useObjectStreams: false });
    return { filename: officialFilename(payload, 'pdf'), pages: pages.length, bytes, blob: new Blob([bytes], { type: 'application/pdf' }) };
  }

  async function createWord(rawPayload) {
    if (!root.docx?.Document || !root.docx?.Packer) throw new Error("The Word export library is unavailable.");
    const payload = normalizePayload(rawPayload || {}), d = root.docx;
    const students = payload.students.map(student => normalizeStudent(student, payload.periodCount));
    while (students.length < MINIMUM_OFFICIAL_ROWS) students.push(normalizeStudent({}, payload.periodCount));
    const paragraph = (text, options = {}) => new d.Paragraph({
      spacing: { before: 0, after: 0 }, ...options,
      children: [new d.TextRun({ text: String(text), font: 'Arial', size: 17, ...(options.run || {}) })]
    });
    const widths = [2820, 720, 1260, 1260, 1260, 1140, 1140];
    const cell = (text, col, options = {}) => new d.TableCell({
      width: { size: widths[col], type: d.WidthType.DXA },
      verticalAlign: d.VerticalAlign.CENTER,
      margins: { top: 20, bottom: 20, left: 65, right: 65 }, ...options,
      children: [paragraph(text, { alignment: col ? d.AlignmentType.CENTER : d.AlignmentType.LEFT, run: options.run || {} })]
    });
    const headers = ['Learner name', payload.periodCount === 3 ? 'Term' : 'Period', `Written Works (${payload.weights[0]}%)`, `Performance Tasks (${payload.weights[1]}%)`, `${payload.periodCount === 3 ? 'Term' : 'Quarterly'} Assessment (${payload.weights[2]}%)`, 'Initial Grade', 'Periodical / Final Grade'];
    const sections = [];
    for (let offset = 0; offset < students.length; offset += 7) {
      const group = students.slice(offset, offset + 7);
      const rows = [new d.TableRow({ tableHeader: true, cantSplit: true, children: headers.map((text, col) => cell(text, col, { shading: { fill: 'E8EDF2' }, run: { bold: true, size: 16 } })) })];
      group.forEach((student, index) => {
        for (let term = 0; term <= payload.periodCount; term++) {
          const final = term === payload.periodCount, grade = student.periods[term] || {};
          const values = [term === 0 ? `${offset + index + 1}. ${student.name}` : '', final ? 'F' : String(term + 1), final ? '' : fixedOrBlank(grade.ww,2), final ? '' : fixedOrBlank(grade.pt,2), final ? '' : fixedOrBlank(grade.qa,2), final ? '' : fixedOrBlank(grade.initial,2), integerOrBlank(final ? student.finalGrade : grade.periodical)];
          rows.push(new d.TableRow({ cantSplit: true, height: { value: 250, rule: d.HeightRule.ATLEAST }, children: values.map((text, col) => cell(text, col, {
            ...(col === 0 ? { verticalMerge: term === 0 ? d.VerticalMergeType.RESTART : d.VerticalMergeType.CONTINUE } : {}),
            ...(final ? { shading: { fill: 'F2F4F6' }, run: { bold: true } } : {})
          })) }));
        }
      });
      const children = [
        paragraph('CST-R FORM 1', { run: { size: 14 } }),
        paragraph('COLEGIO DE STO. TOMAS-RECOLETOS, INC.', { alignment: d.AlignmentType.CENTER, run: { bold: true, size: 23 } }),
        paragraph('Azcona St., San Carlos City, Negros Occidental', { alignment: d.AlignmentType.CENTER, run: { size: 16 } }),
        paragraph(`REPORT ON RATINGS — S.Y. ${payload.schoolYear}`, { alignment: d.AlignmentType.CENTER, spacing: { before: 100, after: 100 }, run: { bold: true, size: 20 } }),
        paragraph(`YEAR & SECTION: ${gradeAndSection(payload)}`, { run: { bold: true } }),
        paragraph(`SUBJECT: ${payload.subject}`, { spacing: { after: 100 }, run: { bold: true } }),
        new d.Table({ width: { size: 9600, type: d.WidthType.DXA }, columnWidths: widths, layout: d.TableLayoutType.FIXED, rows })
      ];
      if (offset + 7 >= students.length) children.push(
        paragraph('SUBMITTED TO / CHECKED BY:', { spacing: { before: 160, after: 160 }, run: { bold: true } }),
        paragraph(`${payload.principalName} — School Principal`),
        paragraph(`${payload.teacherName} — Subject Teacher`, { spacing: { before: 160, after: 100 } }),
        paragraph(Array.from({ length: payload.periodCount }, (_, i) => `${i + 1}: ____________`).join('    '))
      );
      sections.push({ properties: { type: d.SectionType.NEXT_PAGE, page: { size: { width: 12240, height: 15840 }, margin: { top: 720, bottom: 720, left: 1320, right: 1320, header: 300, footer: 300 } } }, children });
    }
    const file = new d.Document({ creator: payload.teacherName || 'CSTR Class Record', title: `Official E-Gradesheet - ${payload.subject}`, sections });
    const blob = await d.Packer.toBlob(file);
    return { filename: officialFilename(payload, 'docx'), pages: sections.length, blob };
  }

  async function exportPdf(rawPayload) {
    const artifact = await createPdf(rawPayload);
    downloadBlob(artifact.blob, artifact.filename);
    return { ...artifact, delivery: "browser-download-requested" };
  }

  async function exportWord(rawPayload) {
    const artifact = await createWord(rawPayload);
    downloadBlob(artifact.blob, artifact.filename);
    return { ...artifact, delivery: "browser-download-requested" };
  }

  return {
    normalizePayload,
    buildRows: (payload) => flattenRows(normalizePayload(payload || {})),
    renderPages,
    createPdf,
    createWord,
    exportPdf,
    exportWord,
    downloadBlob,
    officialFilename
  };
});
