# Readable activities and topics export

The school Excel download and bulk ZIP export now include two worksheets:

1. The existing subject class record, formulas, cached grades, logo and signatories.
2. **Activities and Topics**, an independently sized report using the same saved class/period payload.

The summary repeats the school's letterhead and native logo, subject, grade and section, period, teacher and school year. Written Works, Performance Tasks and Quarterly/Term Assessments form stacked sections. Every section uses the same six aligned columns: No., Date, Activity, Topic, Learning competency and HPS. Numbers refer to activity positions in the website; gaps remain identifiable. Excel coordinate prefixes are removed, and gridlines and row/column headings are hidden on the report sheet.

Type adapts to the content. The exporter measures each saved field and chooses the largest body font from 16pt down to 8pt that fits the available page height. Section headings, title, school header, logo and spacing scale proportionally, and text is rewrapped at each candidate size. Excel's one-page fitting can scale exceptionally dense registers further. Titles, topics, competencies, explicit line breaks, dates and HPS retain their saved meaning; titles starting with `=` remain literal text. Empty slots are omitted and metadata-only entries are included, while empty sections show “No activities recorded.”

Every summary is configured to fit **one 8.5 × 13 inch landscape page**, including long notes and many activities. There are no extra summary pages, manual page breaks or repeated headers. Very long notes use adjacent rows on the same printed page to respect Excel's 409pt row-height limit. No saved website data is changed. Printed readability necessarily decreases as more content is fitted into the same page.

## Verification

- `node tests/activity-summary-browser.cjs`: saved wording, literal titles, dates under Date, topics/competencies under their own headings, sparse columns, empty sections, long notes, 40 activities, adaptive font reduction, one-page settings, no breaks/repeated headers and lossless text.
- `node tests/school-excel-browser.cjs`: 27 grading/layout fixtures and 3 invalid exports. `tests/fixtures/school-excel-main-content.json` records the **pre-change** grade-page content/formula/merge fingerprints from commit `7a29a5c22a8dd7167fbf53813418cacb1d2de286`; all remain identical. The previous whole-sheet fingerprints are retained as historical fixtures.
- `./tests/school-excel-native.ps1`: background Microsoft Excel recalculation, score-edit recalculation, dates, print settings and PDF rendering. Seven representative fixtures checked locally.
- `python tests/school-excel-pdf.py`: exactly two native PDF pages (class record plus one summary), normal-summary readability, complete long notes, dates, learner/signatory content and overflow.
- `./tests/activity-summary-native.ps1` and `python tests/activity-summary-pdf.py`: six native summary PDFs, each exactly one page; all 300 repeated note sentences and all 40 activities remain visible, and actual printed font sizes decrease for dense content.
- Application test suite and `node tools/build-web.mjs` pass.

The historical original-format notes in `EXCEL-PRINT-VERIFICATION.md` describe the prior summary layout. The native template reference mode (`preserveInputs`) continues to use its original layout.
