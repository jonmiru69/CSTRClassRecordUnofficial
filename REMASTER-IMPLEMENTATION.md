# Tabbed record workspace

Implemented on `design/tabbed-record-workspace`, based on `140cc01`. The existing buildless application and bundled dependencies remain in place.

## Design

The worksheet is a flat, scrollable paper surface inside an ink-blue folder. Its three tabs open the existing Full grade sheet, One assessment, and One learner views. Period options sits beside them, retaining period naming, completion, add/lock/delete, Excel, and official PDF/Word export controls. The original Entry view select remains available and synchronized. Row/column tools, the activity register, and the mobile assessment entry flow retain their original handlers.

The supplied image was sampled directly:

| Color | Interface role |
| --- | --- |
| `#FFA322` | Active navigation, dark-theme actions, folder detail |
| `#BB1414` | Primary actions with white labels |
| `#042134` | Navigation, folder cover, selected periods |
| `#181818` | Main ink and dark-theme canvas |
| `#000000` | High-contrast ink and restrained shadows |

White paper and neutral tints maintain readable data density. **Class color choices, stored accents, attendance/descriptor colors, and the existing grading table color coding are preserved.** The class color mapping functions are unchanged. Browser checks compare table text, backgrounds, and border colors with the redesign stylesheet disabled in both themes.

Nimbus Sans handles controls, names, scores and totals; Nimbus Roman supplies document titles. Both fonts already ship locally with `font-display: swap`; system sans/Georgia fallbacks remain available. The sans keeps dense figures familiar and tabular, while the serif gives the record a printed-document character without entering score cells.

## Motion and interaction

- A pointer-driven period change renders the selected data immediately, then applies a 220 ms, 1.8-degree directional page turn to the sheet only.
- Phone/native layouts use a 140 ms sheet fade to avoid changing the containing block of fixed score-entry tools.
- View changes use a short fade. Period options has a 160 ms reveal.
- Keyboard entry and navigation, and reduced-motion mode, update immediately. Enabling reduced motion cancels an in-progress sheet animation.
- Rapid switching cancels the previous animation. No animation callback changes the active period or record data.
- Tabs support Left/Right, Home/End, Enter/Space, visible focus, and synchronized ARIA state. The scrollable tab strip and native select remain usable on narrow screens.

## Preserved behavior

The inspection map is in `REMASTER-WORKFLOW-MAP.md`. Grading arithmetic, transmutation, rounding, HPS recovery, attendance treatment, score adjustments, validation, class management, locked periods, separate quarterly/semestral/trimester collections, drafts, autosave, conflict handling, backups, imports, exports, authentication, and native file delivery retain their original modules and formats. No data migration or new production sample content is introduced.

## Verification

- `pnpm test`: all existing regression groups pass, including grading, HPS/adjustments, malformed input, backup encryption, revision conflicts, export binaries and canonical hosting packaging.
- Existing visual suite: 224 browser checks across desktop, tablet, 390px/320px phones, light/dark themes, reduced motion, 200% phone text, settings and export dialogs.
- New folder suite: 249 browser checks covering tabs and keyboard operation, rapid period changes, SHS semester selection, locked records, owning-period edits, draft/save payloads, HPS cap/recovery, print wrappers, original data colors, and overflow. All use invented records with external requests blocked; no live teacher data is loaded or written.
- `node tools/build-web.mjs` and `node tools/build-pages.mjs`: pass.
- Taste source lint: 0 failures, 0 warnings, with annotated exceptions for the explicitly requested paper depth and functional overlay borders.
- Taste browser inspector at 1440/768/390: 0 failures with documented application exceptions; 4 warnings. Numeric metric labels and save-status checks remain because they convey real state. Paper depth is requested. Marketing requirements for many images, footage, oversized heroes, and a minimum number of moving elements are inappropriate for repeated grading work. The third font is the synthetic QA banner's Arial, not a new product font; existing dense UI type sizes remain. One compact secondary text block remains below 13px.
- Diff whitespace check uses `core.whitespace=cr-at-eol`, preserving the repository's original CRLF files.

## Screenshot critique

Reviewed actual desktop, tablet and phone screenshots of the worksheet, period options, overview, class directory, settings and sign-in in both themes. Three findings were corrected: inherited full-width settings squeezed the tabs; inherited hover transforms clipped the tablet tab edge; and small overview captions were increased to 13px. The class accent edge was retained and data-color tokens isolated when the palette changed.

Final authored assessment: design 8/10, usability 8.5/10, creativity 7.5/10, content 9/10 (weighted 8.15). The folder composition, semantic titles, and active-state contrast read clearly. Full-sheet entry intentionally scrolls horizontally on phones; the existing One assessment view is better for routine phone entry. These scores are design judgments, not user-study results.

No new photographs, footage, or generated imagery were added. Existing campus/crest assets retain their repository provenance. No sample content needs replacing in production; fixtures are test-only.

## Limits and release

Live Firebase authentication/writes, Firebase Emulator Suite, a signed Android build, and physical phone hardware were not exercised locally. Save integration uses the repository's synthetic adapter. Existing exports and rule-expression test doubles do not replace production acceptance or emulator tests. Browser rendering was checked in installed Chrome.

The review branch is not a deployment. Merging to `main` invokes the repository's Android/web release workflow; review and approve that separately.
