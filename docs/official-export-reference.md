# Official export reference and validation

The supplied `REFERENCE E-GRADESHEET.xlsx` was inspected read-only across all 13 worksheets, including cell text, fonts, number formats, alignment, borders, merged ranges, row/column dimensions, print settings, headers/footers, and signatories. A separate hidden Excel instance was used to verify native point measurements. The reference workbook and its learner data are not included in this repository.

## CST-R Form 1 measurements

| Element | Reference measurement |
| --- | --- |
| Paper | Folio portrait, 612 × 936 pt (8.5 × 13 in), Excel paper code 14 |
| Side margins | 6 mm (17.0079 pt) |
| Top/bottom margins | 9 mm (25.5118 pt) |
| Printed worksheet gridlines | Off; retain the form's explicit black table borders |
| Running headers / footers | Empty |
| Columns A:G | 118.5, 50, 77, 85.5, 96.5, 61, 80 pt |
| Filipino column B | 69 pt; its complete table is scaled slightly to stay inside the printable width |
| Heading rows 1–9 | 14.5, 18.5, 34, 15.5, 14.5, 23.5, 14.5, 18.5, 18.75 pt |
| Table heading row | 30 pt |
| Body / signatory row | 15.75 pt |
| School heading | Merriweather, 24 pt |
| Address / report title | Calibri, 12 / 18 pt |
| Year, section, subject | Calibri bold, 14 pt, one merged line |
| Learner names | Times New Roman, 11 pt, vertically merged per learner |
| Period labels | Times New Roman bold, 12 pt |
| Component / initial values | Calibri, 12 pt |
| Final grade | Calibri bold, 14 pt |
| Numeric display | WW/PT/QA and initial grade 0.00; periodical/final grade 0 |
| Signatories | Submitted/check label; blank row; principal and teacher side by side; italic School Principal; teacher signature caption; blank row; quarter receipt lines |

The standard subject forms share these dimensions except Filipino's wider period column. TLE, Music & Arts and PE & Health have different component percentages; exports continue to use the class's existing subject weights. The source's consolidated MAPEH and consolidated ratings worksheets were examined as distinct forms; the existing subject exporter remains CST-R Form 1.

## Export behavior

Word uses editable native tables. PDF uses selectable vector text and embedded fonts. Both consume the same measured page model. Column widths, explicit borders, merged learner names, heading text, and signatory lanes are retained. Long text is fitted inside its lane. Page fragments repeat the learner identity where necessary without clipping. The reference's accidental horizontal print spill is not reproduced.

The class-record Excel exporter hides unused WW/PT/QA raw-score columns, including gaps. HPS, date, meaningful activity metadata, or any learner score makes a column used; zero is data. Role defaults alone do not make an activity used. The original score ranges, Excel formulas, weights, attendance-code treatment, transmutation, and grading engine remain intact. Metadata, signatories and the activity register are repositioned onto visible columns so none disappear when raw-score columns are hidden.

Bulk export scans active classes in the selected workspace calendar and checks data again at download. It requires named learners, valid aligned assessment arrays, valid period identities, valid HPS and scores, configured required groups, and complete learner calculations. Lock status alone never qualifies a quarter. Duplicate identities and incomplete/invalid quarters are excluded. The ZIP contains one Excel class record per accepted quarter and/or Word/PDF gradesheets containing only the accepted periods. Partial-year gradesheets omit the final-grade row and unused learner placeholders. No average of a partial year is presented as a final grade.

Mr./Ms. titles are separate from stored names. The owner defaults to Mr.; every signatory has a pre-export title selector. Formatting removes duplicate Mr./Ms. prefixes. The owner title also appears in individual learner PNG reports.

## Validation

- `pnpm test`: existing functional tests plus bulk selection/ZIP regression checks.
- `pnpm test:exports`: visible-column and formula fingerprints for 18 subject presets plus sparse, pending and expanded/zero cases; actual Word/PDF creation; desktop/phone bulk download and signatory selectors.
- `pnpm test:visual`: existing visual workflow checks, including the updated compact native-template snapshots.
- Optional on Windows with Excel and Word: run `powershell -NoProfile -File tests/reference-exports-native.ps1` after `node tests/reference-exports.cjs`. This opens synthetic exports in separate hidden instances, verifies native Excel recalculation, and renders Word/PDF previews.

Native Excel recalculation was verified for every subject preset and the three edge cases. Native Word rendered the complete synthetic sample on four Folio pages and the Q1/Q2-only sample on one page. The original export formulas were compared directly before recording the immutable formula fingerprints. The complete functional suite and synthetic learner-report PNG checks also passed.

## Export corrections

Signatory names and titles are reused across classes and saved with the workspace. Subject-area recommendations follow the subject; JHS and SHS coordinator recommendations remain separate. Existing class export settings also supply recommendations. Individual and bulk exports, including principal names entered in Word/PDF dialogs, update these defaults after successful file delivery.

WW, PT and QA use the same two-decimal, half-up display rounding (for example, 1.005 prints as 1.01). Raw values and grading formulas are unchanged.

Merged boxes have explicit perimeter borders on all constituent cells after column compaction. Interior merged-cell seams are removed; borderless headings and single-edge signature lines retain their form. Regression checks cover merged perimeter continuity across every subject preset and sparse/expanded layouts, with native Excel recalculation and printed-header inspection.
