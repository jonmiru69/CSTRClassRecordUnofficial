# 24 October 2026 — action labels, descriptors and concise interface copy

Based on repository main `f7477e1a33d8f338a2d1669b9347bb3df5edfb99`.

Buttons now animate one continuous underline beneath their primary phrase, including spaces. Inline emphasis is retained. Leading/trailing decorative symbols, card metadata, file extensions and secondary lines remain outside that phrase. Class cards underline only their subject. Link-based actions receive the same treatment. Reduced-motion preferences remain supported.

Qualitative descriptors retain their existing names and thresholds. Text uses green for Advancing, blue for Benchmarking, teal for Connecting, amber for Developing and rose for Emerging. These are semantic interface cues, not a claim of universal psychological effects. Colors adapt to light and dark surfaces; the navy report header uses bright variants in the readable report and PNG export. Labels remain visible so color is supplementary.

The heading displays the small italic policy reference **DepEd Order No. 015, s. 2026**. It replaces the previous two-line reminder and stays visible at desktop, tablet and phone widths.

## Why the heading does not claim blanket compliance

The official order's paragraphs 48–50 distinguish adjusted transmutation for SY 2026–2027, the Grade 12 transition exception and zero-based grading beginning SY 2027–2028. The app supports configurable weights and ties zero-based behavior to its trimester mode. A universal “COMPLIANT” label would therefore claim more than this presentation revision has established. The requested policy reference is included; grading modes and formulas were deliberately preserved.

Primary source: [DepEd Order No. 015, s. 2026, official PDF](https://www.deped.gov.ph/wp-content/uploads/DO_s2026_015r.pdf), printed pages 11–13, particularly paragraphs 44–52. The official PDF was downloaded and its scanned pages visually inspected.

Routine profile, class chooser, scrolling, activity register, entry-view, signup and export instructions were removed or shortened. Save status, required-field validation, conflict handling, destructive-action confirmations, recovery limitations, optional keyboard help, score legends and privacy information remain available. No records were accessed or migrated.

## Apply the update

Replace/add the following paths at the repository root, preserving their folders:

- `ASSETS/app.js`
- `ASSETS/interaction-polish.js`
- `ASSETS/ui-refinements.css`
- `index.html`
- `policies.html`
- `README.md`
- `REVISION-2026-10-24-POLISH.md`
- `tests/polish-last-run.txt`

The update-only ZIP contains exactly these files. The full ZIP contains the entire source tree. Neither contains real learner data, account credentials or the downloaded policy PDF. Hosting and database configuration are unchanged. Updated asset query versions prevent reuse of the previous UI scripts/styles after publication.

## Verification

- 57 portable regression checks passed: grading, adjustments, recovery, rendering, export serialization and category/data protection.
- 50 Chrome browser checks passed with synthetic records, including add/reverse points, calendars, all quarter tabs, actual PNG generation and long-report ZIP export.
- 22 focused presentation checks passed: continuous phrase geometry, inline formatting, click behavior, idempotence, all five descriptor colors, policy reference layout and record-state preservation.
- 228 theme/viewport scenarios passed: 38 scenes × two themes × desktop/tablet/phone widths. No scanned visible-text contrast failures, unloaded visible images or browser exceptions. SVG report inks were separately checked through report generation and rasterization; the contrast scanner excludes SVG text.
- Eight grading/data/configuration modules remain byte-identical to the base commit. A source-block comparison found 187 existing app function blocks unchanged; changed blocks contain presentation or user-facing copy edits and one new descriptor ink helper.

These checks use synthetic records and test doubles. They do not constitute a policy certification or a deployed Firebase acceptance test. Logs are in `tests/polish-last-run.txt`; screenshots and machine-readable audits are in the separate verification archive.

## Publication status

The source is complete and tested locally. Publishing was attempted through the connected GitHub integration, which returned HTTP 403 “Resource not accessible by integration.” The local Git connection also reported that GitHub credentials were unavailable. The repository and live site have not been updated by this task. Repository write access through the GitHub connection, or an authenticated local Git connection, is required to publish.
