# Folio Excel printing — 20 November 2026

The school Excel export now uses 8.5 × 13 inch Folio paper in landscape at 100% scale. The school's logo, institutional headings, component groups, grade colors and grading formulas are retained. Metadata lanes and column widths are arranged for the paper rather than fitting an oversized worksheet onto one page.

Choose **Print Entire Workbook** in Excel to print the grade record followed by the activity register. Paper size, landscape orientation, scale, margins and page breaks are already stored in both worksheets. There is no need to adjust those settings. Large rosters continue onto additional grade pages with repeated headings; unusually wide assessment records continue horizontally with learner numbers/names repeated. Long names can require more pages.

The grade record has 0.25 inch side margins and 0.30 inch top/bottom margins. Its body uses 8 point type and score headings use 7 point type. Every score-grid cell, including empty and inserted cells, has explicit black borders. Date headings use numeric Excel dates with a short vertical display. The following activity register uses 9 point type, full dates with four-digit years, HPS, activity titles, assessment groups, competencies and topics. Signatories remain at the bottom of the final grade page and wrap instead of shrinking to an unreadable size.

## Diagnosis

The old exporter explicitly requested one page wide **and** one page tall, horizontally centered, and removed manual breaks. Its 48-learner test record measured 1,588.5 points wide in Excel, with the activity register inside the same print area. Excel shrank everything into one page. Dates could display `###`. The old automated test explicitly expected those one-page settings.

The initial regression failed with `undefined !== '100'` on the required actual-size print scale. Native Excel rendering subsequently caught a last-column spill caused by printer font metrics and an overflow in a fractional percentage weight. The column allocation was corrected against the rendered pages rather than relying only on nominal widths.

## Verification

- `pnpm test`: application, grading, attendance, score provenance, exports and hosting regressions.
- `node tests/school-excel-browser.cjs`: 26 synthetic workbooks and three invalid exports. Covers all 18 subject categories, zero-based grading, transmutation precision, fractional weights, 30/48 learners, long names/competencies, attendance/pending marks and 270 alternating assessment columns. Checks cached results against the grading engine, live formula length, validation, all grid borders, print areas, dates, signature wrapping and manual pagination.
- `./tests/school-excel-native.ps1`: opens each generated workbook in installed Microsoft Excel, forces full recalculation, compares initial/reported grades and descriptors, edits a score, recalculates against an independently generated expected result, restores the score, and checks Folio/100% settings, date/percentage overflow and horizontal pagination. Requires Windows and Excel; does not send jobs to a printer or save changes to the source workbooks. Use `-Cases` for a focused rerun.
- `python tests/school-excel-pdf.py`: checks six representative PDFs produced by Excel, using `pdfplumber`. Verifies exact 936 × 612 point pages, expected page counts, borders inside margins, full final columns, unshrunk type, complete learner lists, full register dates, competency text, pending descriptors and bottom signatures.
- Visual review of Excel-produced PDF pages: the 30-learner record occupies one grade page and one register page; the 48-learner record occupies two grade pages and one register page. Long signatories and long activity text remain readable.
- `pnpm build:web`: packages the website with content-versioned assets.

Only synthetic records are included in tests and review artifacts. The supplied school example was inspected as a layout reference and was not changed or added to the repository. Native testing used the installed Excel for Microsoft 365 with an EPSON L3210 driver; physical ink-on-paper output and other printer drivers were not tested. The PR does not itself deploy the website or update installed Android applications.
