# Theme, card and grade-sheet refinements

Baseline: current repository main commit `054966e2675adcb5a36118d2b86ab1ba6a1dfc82`. The source was fetched from the supplied repository and rechecked before packaging.

## Implemented requests

| Request | Result |
| --- | --- |
| Light/dark contrast | Replaced conflicting legacy colors in sheet names, scores, dates, HPS, activity fields, placeholders, selected school-level cards, one-learner panels, chart labels, feedback, and empty-photo captions. Locked and focused fields use the correct theme. Photos, the crest and campus imagery keep their original colors. Screen charts adapt; downloadable report artwork deliberately keeps its paper palette. |
| Compact green plus | Replaced repeated score-cell text actions with a small green **+** at the upper-right of each score, using a 24px click target and an accessible name/tooltip. An adjusted score retains its small addition indicator. Click **+**, then **Cancel added points** in its dialog to restore the raw score. This still works at HPS and in one-learner mode. Reasons/history are retained. |
| Colored class edges | Restored the four JHS and three SHS identification bands. Individual subject cards also display their saved class-color edge. Dark-mode variants keep dark class colors visible without changing the saved color choice. |
| Subject-only card underline | Only the subject words animate an underline on subject cards and overview class rows. The whole card still responds to hover. Grade/section details, weights, counts and the open-sheet hint stay plain. |
| Meaningful action emphasis | Multi-line and compound actions underline primary words individually, so wrapping never draws a long line beneath empty space. Punctuation, checks, emoji, arrows, auxiliary descriptions, subject-weight previews, counts and file extensions are excluded. Keyboard focus and reduced-motion behavior remain available. |
| Denser sheet contents | Reduced sheet data to 12px, supporting headers/dates to 11px, cell padding, learner-row height and name-column width. Long names retain their full stored value and a full-name tooltip, with a bounded column instead of growing the sheet indefinitely. The outer sheet viewport and workspace width are preserved. |
| Data hierarchy | Component headings and category dividers are bold. HPS values are bold; explanatory HPS sublabels use restrained italics. Raw numeric scores and percentage scores use regular weight and upright tabular numerals. Totals and weighted scores use medium emphasis; initial grades are stronger; final transmuted grades are the largest and boldest sheet data. Attendance letters retain their semantic colors. |

## Measured layout

At 1440px desktop width, using identical synthetic records:

| Measurement | Before | After |
| --- | ---: | ---: |
| Outer sheet viewport | 1180px | 1180px |
| Learner name column | 190px | 164px |
| Learner row | 75px | 37px |
| Content width requiring horizontal scroll | 2492px | 2030px |

The viewport remains full width; the denser contents need less scrolling. Phone layouts retain horizontal scrolling inside the sheet rather than pushing the whole page sideways.

## Verification and data boundaries

- 57 existing portable checks passed, covering the grading examples, rounding, attendance, score adjustments, provenance, normalization, rendering, export generation and sync-rule expressions.
- 50 browser regression checks passed, including add/cancel at HPS, exact raw-score restoration, retained history, one-learner editing, quarter-specific PNG downloads and long-report ZIP output.
- 28 additional UI interaction checks passed for colored edges, subject-only emphasis, punctuation exclusion, reduced motion, click-target geometry, compact rows, full-width viewport retention, responsive scrolling and unchanged record state during theme/navigation changes.
- Contrast was audited across 38 rendered screen/state variants in both themes at 1440px, 768px and 390px: 228 scenarios. The final flat-background text scan reported no failures against 4.5:1 for normal text or 3:1 for large text. This is a scoped automated audit, not a formal accessibility certification. Disabled controls and embedded paper-report SVG text are excluded from that scan; representative screenshots and the report output were also visually reviewed.
- No uncaught browser exceptions were reported. Tested visible images loaded successfully. Desktop, tablet, phone, hover, dark-mode, light-mode and one-learner screenshots are supplied separately.

`ASSETS/grading-engine.js`, `ASSETS/record-tools.js`, Firebase synchronization/configuration/rules, backups and official export modules are unchanged byte-for-byte. The app changes are limited to rendered controls, text-emphasis markup, and name-column fitting. There is no record migration, score rewrite or grading formula change. Tests used synthetic records with cloud access disabled; no live student records were read or written.

The supplied browser audit scripts use the design-taste skill's Chromium helper for screenshot and computed-style inspection. This is a component/interface review under the existing palette; landing-page imagery and marketing composition rules are not applied to the working grade sheet. Hover feedback remains lightweight and honors reduced motion; no universal frame-rate guarantee is made.

Authenticated production saves and a deployed Firebase emulator run were not exercised. Existing Firebase logic was preserved and its existing local tests passed. Cloud-unavailable messages in screenshots belong to the deliberately disconnected synthetic fixture.

## Apply these files together

Extract the **UI UPDATE-ONLY ZIP** into the repository root, retaining the `ASSETS/` and `tests/` paths, then commit the included files together. The new `ASSETS/ui-refinements.css` is required and is loaded after the existing styles in both HTML pages. The complete-source ZIP and Git patch are alternatives for the same update. This source package is not a live deployment.
