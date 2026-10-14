# Change record and coverage

This is a review-driven release candidate built from the supplied local repository copy. The original files and live services were not modified.

| Area | Implemented change | Practical limit / next verification |
|---|---|---|
| Legacy account takeover | Removed public claim UI and client binding; rules deny client bindings and ticket approval. | Developer must audit old bindings and reset passwords that reused exposed codes. |
| New accounts | Account creation and access approval are separate; developer approves exact UIDs. | Verify people through the school; configure Auth password policy and admin MFA. |
| Concurrent saves | Firebase transaction compares accepted revision; rules require protocol 2 and next revision; server timestamp. | Whole-workspace conflicts require a deliberate choice. No automatic cell merge. |
| Conflict recovery | Both versions can be backed up; version-choice confirmation and session checkpoints. | User must download backups before closing/logging out. |
| Offline recovery | Recovered drafts are checkpointed before cloud loading; offline drafts remain dirty; saves wait for synchronization. | Real offline/reconnect browser tests remain required. |
| Local privacy | Sensitive drafts/history use sessionStorage; current-account recovery clears on logout; Firebase Auth uses session persistence. | Session restoration can retain tabs. Old data under another account/origin requires browser site-data cleanup. |
| Durable backups | AES-256-GCM encrypted files, PBKDF2-SHA256 600,000 iterations, random salt and nonce; structural checks and 25 MB import limit. | Forgotten passphrases cannot be recovered. Plain document exports remain unencrypted. |
| Input hardening | Photo data URL type/size checks, escaped photo and class attribute values, backup shape/prototype checks. | This is not a penetration-test certification; keep third-party libraries maintained. |
| Navigation hierarchy | Active classes and progress appear ahead of collapsed optional profile; blank defaults instead of fabricated teacher details; age entry removed. | Existing saved age is preserved for compatibility; authorize its removal separately if needed. |
| Mobile entry | Sign-in appears ahead of introductory content; one-learner view stacks score/summary cards; full spreadsheet view remains. | Dates and HPS are edited in full-sheet view. Mobile and keyboard behavior need real-browser acceptance. |
| Buttons and typography | Filled primary actions, outlined secondary/danger actions, visible focus rings, disabled states, 44 px interaction targets, larger sheet text. | Full contrast/zoom/screen-reader audit and rendered-layout inspection remain open. |
| Dialogs | Shared focus containment, background inertness, fallback labels and focus return; native encrypted-backup dialogs. | Keyboard acceptance across every dialog is required; no WCAG certification claimed. |
| Clarity | Clear unofficial branding, expanded grade abbreviations, approval and recovery instructions, developer contact, accurate logout consequences. | The operator must publish a school-approved retention period. |
| Performance | Export bundles load on demand; campus image and displayed logo compressed; unused CSS/JS/fonts and duplicate images removed. | Vendor bundles remain pinned to the supplied versions. No dependency security audit or upgrade claimed. |
| Stylesheet maintenance | Removed unused stylesheets; reviewed component rules isolated in review.css. | The legacy active stylesheet remains large. A full CSS rewrite was not attempted without browser regression evidence. |
| Exports | Existing grading/export engines preserved; on-demand dependencies; principal name requires user entry. | PDF binary generation, print layout, mobile downloads and official-school-format approval require acceptance. |
| Policy and documentation | Single matching technical notice in page/dialog; private support email; deployment, migration, rollback and quota instructions. | School/legal authorization and retention decisions cannot be supplied by code. |
| Free deployment | Static Firebase Hosting configuration, Spark-only deployment route and security headers. | You must deploy and verify the actual account plan/quotas. No paid services are introduced. |

## Measured performance changes

- Campus image: 2,447,266 → 75,942 bytes (about 96.9% smaller).
- Displayed logo: 830,785 → 29,564 bytes (about 96.4% smaller).
- Five export libraries totaling approximately 2.66 MB uncompressed are removed from initial script loading. They remain locally bundled and load for the selected export format.
- Dormant stylesheets, motion script, duplicate campus originals and unused Quicksand font files are removed from the deployable folder. Nimbus export fonts and license files remain.

## Preserved calculation behavior

`grading-engine.js`, `record-tools.js`, `excel-export.js`, and `official-egradesheet.js` are byte-identical to the supplied source. This avoids silently changing institutional grading rules. Tests cover their current behavior, including blanks versus zero, attendance exclusions, QA weights, transmutation monotonicity and HPS score restoration. Passing tests demonstrates consistency with this implementation; it does not establish that a specific school or DepEd policy authorizes these formulas.

## Recommendation coverage requiring action outside the files

Exposed-password resets; approval and binding audits; administrator MFA; Firebase rules publication; actual deployment; school authorization; retention policy; Git history cleanup where appropriate; and live acceptance testing must be completed by the developer. UID-key migration is a separate optional maintenance operation; verified existing legacy mappings remain supported. These steps are documented rather than falsely represented as already completed.
