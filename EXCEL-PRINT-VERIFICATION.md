# Original-format Excel printing — 20 November 2026

Historical verification of the previous layout. The current readable summary is documented in [activity-summary-export.md](docs/activity-summary-export.md).

The export retains the current worksheet, content, formulas, cell positions, colors and merged tables. It does not create a new activity-register table or a separate worksheet.

## Print behavior

- Paper is **8.5 × 13 inches, landscape** (Excel Folio code 14).
- Page 1 contains the existing school header, full class record and signatories. It fits one page, centered horizontally and vertically, with equal 0.25 inch configured margins.
- Page 2 contains the existing **Summary of Activities and Topics** in its original three-group layout. Two print areas on the same worksheet make ordinary worksheet printing include both pages. Grade headings are not repeated on the register page.
- Cell fonts are increased up to 15 points, with automatic print fitting as the learner count increases. The printed font is scaled to satisfy the one-page class-record requirement; 15 points is the maximum worksheet font, not a promise of 15-point physical print for dense records.
- WW/PT date columns are enlarged to the same width. Dates remain real Excel dates in their existing formats. Component-weight columns accommodate precise fractional percentages.
- Text wraps with measured row heights and padding. Native labels that intentionally extend into adjacent blank cells retain that behavior. Missing grid-border sides are repaired while retaining existing border styles and fills.
- The signatory block stays at the bottom, with a target of 28 physical points of signing space. The school picture keeps its original image data, anchor location and native dimensions instead of stretching with the resized cells.

## Verification

`node tests/school-excel-browser.cjs` exercises 27 synthetic records and three invalid exports. It covers all 18 grading categories, zero-based grading, fractional weights and precision boundaries, attendance/pending marks, 30/48/65 learners, long names/activity text and 270 alternating assessment columns. `tests/fixtures/school-excel-content.json` records the original export's content/formula/position/merge fingerprints from baseline commit `3a08c69753f33849c990e587776dcdd769ee9267`. Every revised export must match its original fingerprint. Tests also check explicit borders, uniform date widths, font limits, margins, centering and print areas.

`./tests/school-excel-native.ps1` opens the generated workbooks in installed Microsoft Excel, forces recalculation and checks initial grades, reported grades and descriptors against the grading engine. It edits a score, verifies recalculation and restores it. It also checks Folio landscape, automatic fitting, equal margins, date/percentage display and worksheet/print-area structure. Use `-Cases` for a focused run. Requires Windows and Excel; it does not send print jobs or save edits to source workbooks.

`python tests/school-excel-pdf.py` uses `pdfplumber` to inspect seven PDFs produced by Excel. It requires exactly two 936 × 612 point pages; verifies that all learners and signatories are on page 1, the original register is on page 2, dates have no overflow, visible margins are balanced, wrapped body text does not cross row borders, signing space remains available, and printed font size adjusts for a larger roster.

The application suite (`pnpm test`) and website packaging (`pnpm build:web`) also run. PDFs are visually inspected after rendering to page images.

All fixtures and review samples use synthetic data. The supplied external workbook was not changed or copied into the repository; the current export is the baseline. Layout verification uses Excel for Microsoft 365 with the installed EPSON L3210 driver. Physical ink-on-paper printing and other printer drivers have not been tested. Merging the PR follows the repository's existing deployment process.
