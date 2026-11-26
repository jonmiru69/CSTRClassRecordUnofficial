# Readable activities and topics export

The school Excel download and bulk ZIP export now include two worksheets:

1. The existing subject class record, formulas, cached grades, logo and signatories.
2. **Activities and Topics**, an independently sized report using the same saved class/period payload.

The summary repeats the school's letterhead and native logo, subject, grade and section, period, teacher and school year. Written Works, Performance Tasks and Quarterly/Term Assessments form stacked sections. Every section uses the same six aligned columns: No., Date, Activity, Topic, Learning competency and HPS. Numbers refer to activity positions in the website; gaps remain identifiable. Excel coordinate prefixes are removed, and gridlines and row/column headings are hidden on the report sheet.

Body text is 16pt Arial, section headings 17pt and the report title 26pt before print fitting. Rows wrap according to measured text width. Titles, topics, competencies, explicit line breaks, dates and HPS retain their saved meaning; titles starting with `=` remain literal text. Empty slots are omitted and metadata-only entries are included, while empty sections show “No activities recorded.”

Normal summaries fit one 8.5 × 13 inch landscape page. Exceptionally large registers or lengthy notes continue onto additional pages with the school/class header and column labels repeated. This preserves all content and readable type instead of shrinking hundreds of activities onto one page. Very long notes are split across continuation rows to respect Excel's 409pt row-height limit. No saved website data is changed.

## Verification

- `node tests/activity-summary-browser.cjs`: saved wording, literal titles, dates under Date, topics/competencies under their own headings, sparse columns, empty sections, 16pt body styles, and lossless continuation text. The pre-change exporter fails this regression check.
- `node tests/school-excel-browser.cjs`: 27 grading/layout fixtures and 3 invalid exports. `tests/fixtures/school-excel-main-content.json` records the **pre-change** grade-page content/formula/merge fingerprints from commit `7a29a5c22a8dd7167fbf53813418cacb1d2de286`; all remain identical. The previous whole-sheet fingerprints are retained as historical fixtures.
- `./tests/school-excel-native.ps1`: background Microsoft Excel recalculation, score-edit recalculation, dates, print settings and PDF rendering. Seven representative fixtures checked locally.
- `python tests/school-excel-pdf.py`: native PDF page count, printed summary body size (at least 12pt for one-page fixtures), repeated continuation headers, complete long notes, dates, learner/signatory content and overflow. The standard fixture prints its summary body at approximately 15.5pt; physical output still depends on the printer.
- Application test suite and `node tools/build-web.mjs` pass.

The historical original-format notes in `EXCEL-PRINT-VERIFICATION.md` describe the prior summary layout. The native template reference mode (`preserveInputs`) continues to use its original layout.
