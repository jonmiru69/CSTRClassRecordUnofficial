# Faculty ledger visual remaster

The later teacher-introduction revision places Teacher details first in the Overview. See `TEACHER-INTRODUCTION.md`; it supersedes the original overview ordering described below.

The visual system now links the real campus cover, navy navigation, burgundy actions, class directory and paper-like grade sheet. Classes and completion lead the teaching desk; teacher details remain fully editable below. The source order matches the visual order for keyboard navigation.

## Scope

The only production changes outside the new presentation assets are welcome-page markup/copy, overview markup order, and stylesheet/script links in `index.html`. Grading, score adjustment, sync, authentication, registration, recovery, exports, stored schemas, Firebase rules and Android native code are unchanged. No migration is required.

`ASSETS/visual-remaster.js` only updates a CSS property on the public campus cover. It has no data or storage access. `ASSETS/visual-remaster.css` is screen-only. The real table grid, sticky cells, selection behavior, phone entry forms and print output keep their existing mechanisms.

## Reproduce

Use Node 24 and the locked dependencies:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm test:visual
pnpm build:web
pnpm build:pages
```

The optional browser suite uses an installed Chrome and pinned `playwright-core`; it starts its own loopback server. It generates a clearly labeled synthetic preview, blocks all external requests and instruments the app only in the test response. No test hooks are shipped in production files. Screenshots and the check report are written to `.build-artifacts/visual-remaster/`.

The synthetic fixture does not include actual teacher or learner information. During this task, the live site was visited only for visual inspection: no record fields were edited, no record save was requested, and no live export or recovery action was performed. Credentials are not stored in source, fixtures, documentation or deliverables.

## Verification

The full existing regression suite passes, including grading arithmetic, transmutation, attendance marks, score additions/reversals, HPS recovery, input integrity, encrypted backup, sync conflicts, owner isolation expressions and Excel/PDF/Word generation. Both canonical and Pages packages build.

The final browser run passed **224 checks**, generated **28 screenshots**, and recorded zero page errors and zero requests to external services. Coverage includes desktop, intermediate breakpoints, tablet, 390px and 320px phones, light/dark themes, reduced motion, enlarged phone text, navigation, overview ordering, locked periods, assessment/learner views, zero/attendance/invalid score entry, settings, add-class/export dialogs, record preservation, contrast and unchanged print styles. The release workflow now runs this synthetic browser suite before release.

Taste inspector: 0 failures with the explicitly documented `few-pictures` exception. The supplied campus photograph is the one authentic photo needed here; adding unrelated stock photos to satisfy a marketing-page quota would weaken this class-record interface. Remaining warnings are intentional: no footage and restrained motion. There is no honest supplied campus clip and no need to animate the teaching workspace. Source lint: 0 failures; form-control boundaries are intentional.

Visual reviews used actual screenshots at desktop, tablet and phone sizes. Changes after review: repaired inherited active-navigation text contrast, kept compact phone layouts, corrected the profile photo's inherited flex sizing, placed the idle attendance toolbar in flow, and aligned overview DOM order with visual order.

Final authored review: design 8/10, usability 8.5/10, creativity 7.5/10, content 9/10 (weighted 8.15). MotionSites rubric: average 8/10, no category below 7. The emphasis is a usable teacher workspace rather than cinematic spectacle. These are design judgments, not a user study.

Physical Android/iPhone hardware, native APK build/signing, Firebase emulator tests and production write operations were not exercised in this visual change. The existing cloud/grading code is unchanged. Browser checks and test doubles cannot guarantee the absence of every possible bug.

## Review and release

Keep the change on its review branch until approved. Do not merge, deploy, run a data migration, or change production Firebase rules as part of visual review. The existing workflow releases Android/web updates on `main`; merging therefore has deployment consequences.

Detailed direction and skill adaptations: `scrollcraft/builds/faculty-ledger/BRIEF.md`. Existing campus/crest assets retain their repository provenance; no new media needs replacement, licensing or attribution.
