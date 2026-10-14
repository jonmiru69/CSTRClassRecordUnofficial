# Verification report — updated 14 October 2026

## Checks executed successfully

Runtime: Node.js 24.19.0 on the provided Windows workspace.

- `node tests/run.cjs`: **26 checks passed**. JavaScript parsing; grading worked example; missing versus zero; A/M and E/L handling; zero HPS; QA normalization; transmutation monotonicity; HPS cap/reversal and explicit edits; group-label classification; AES-GCM round trip; incorrect password and tamper rejection; malformed/prototype import rejection; simulated atomic revision conflicts; disabled legacy binding; account-isolation and revision-rule expressions; immutable profile mapping; lazy export references; session-storage recovery.
- `node tests/render-smoke.cjs`: sign-in, registration, recovery, task-first dashboard and synthetic grade-sheet templates render without exceptions using DOM stubs.
- `node tests/export-smoke.cjs`: Excel serialization/reopen preserves zero and literal text beginning with `=`; official Word generation produces a ZIP containing document.xml and supplied metadata; official SVG page generation succeeds.
- Syntax checks passed for the optional Firebase emulator script and mapping-preparation tool.
- Byte comparison confirmed no changes to the four grading/record/export engines listed in CHANGES.md.

The tests contain only synthetic data. They do not contact production Firebase.

## Verification limitations

Rendered browser checks succeeded after restoring network access: desktop and 390px sign-in, registration messaging, privacy dialog and Escape focus restoration. A synthetic browser session verified dashboard ordering, learner-name and HPS entry, one-learner mode, score entry, mocked save, and Settings opening. These checks do not establish production sign-in or persistence.

The real Firebase Database Emulator v4.11.2 ran successfully using Java 21 and Firebase CLI 15.33.0. All assertions in tests/firebase-emulator.cjs passed: anonymous/pending/cross-account reads denied, verified legacy binding allowed, client approval/ticket/binding writes denied, valid revision accepted, stale revision/deletion/old-client writes denied. This verifies the rule parser and authorization behavior against synthetic data; production acceptance remains separate.

No production Authentication sign-in, password reset, approval, database save, reconnect, rules publication, Hosting deployment or real-user migration was performed. No production test account was created. PDF binary generation and rendered print layouts were not verified. No screen-reader audit, formal accessibility conformance assessment, dependency vulnerability scan, penetration test, legal certification or institutional grading approval is claimed.

## Required release acceptance checklist

Use synthetic teachers and learners first. Complete this checklist before opening the revised site to real records.

### Security and accounts

- [x] Run `tests/firebase-emulator.cjs` through Firebase emulators:exec with project `demo-cstr-review` (14 October 2026).
- [ ] Anonymous and pending accounts cannot read/write records.
- [ ] Teacher A cannot read or change teacher B's records or binding.
- [ ] New account creation yields a pending account; approval of its exact UID enables onboarding.
- [ ] Google and email/password sign-in work on the actual authorized Hosting domain.
- [ ] Password reset works; an incorrect password does not expose learner data.
- [ ] Client attempts to create approval/tickets/bindings are denied.
- [ ] A verified existing account loads the correct older record without duplication or deletion.
- [ ] Deleting approval prevents subsequent reads/writes. Never use boolean false as revocation.

### Saving and recovery

- [ ] Open a synthetic workspace in two separate browser sessions. Make unsaved edits on both. Save A; B must not silently overwrite A.
- [ ] Back up both versions in B, choose one, and save. A third intervening save must still cause a conflict.
- [ ] Edit while a save is pending. Later edits remain dirty until their own save succeeds.
- [ ] Disconnect, edit, reconnect and reload with a draft. Confirm recovery remains available and cloud data is not silently replaced.
- [ ] Download/restore an encrypted backup; wrong password and a modified file fail safely.
- [ ] Cancel backup/import and cancel destructive confirmations; no data changes occur.
- [ ] Log out after saving; current-account draft/history are removed. Discard-and-logout accurately warns of data loss.
- [ ] Restore a checkpoint and confirm the intended version reaches the cloud.

### Interface and accessibility

- [ ] Inspect at 360, 390, 768 and 1366 px widths and at 200% zoom in current Chrome/Edge, plus a real mobile browser.
- [ ] Sign-in remains task-first; controls do not overlap or get clipped; long names and email addresses wrap.
- [ ] Light/dark mode keeps readable contrast, visible focused controls and clear button hierarchy.
- [ ] Keyboard-only: enter every dialog, Tab/Shift+Tab remain inside, Escape/cancel works, and focus returns usefully.
- [ ] Screen reader: field labels, dialog names, save/error announcements and table context make sense.
- [ ] One-learner cards display the selected learner only; score edits save correctly; full-sheet dates/HPS still work.
- [ ] Add/edit/archive/restore classes; add/remove periods and columns; roster paste; HPS changes; lock/unlock; lookup; all work with synthetic data.

### Calculation and exports

- [ ] Responsible staff approve the calendar, subject weights, QA intra-weights, attendance handling, transmutation and final-average policy.
- [ ] Hand-calculate representative scores and boundary cases; compare screen, Excel, PDF and Word.
- [ ] Check blank learners, zero scores, attendance codes, Unicode names, long subject names and more than 50 learners.
- [ ] Open exported Excel in the intended spreadsheet software and verify print settings.
- [ ] Open PDF/Word, confirm page breaks, fonts, clipping, principal/teacher names and correct school year. Confirm official layout with the school.
- [ ] First export lazily loads required assets; a failed load gives a usable retry message.

### Deployment and operation

- [ ] Production database and old rules are privately backed up; previous code-password users reset passwords; ownership mappings reviewed.
- [ ] Project remains Spark with no billing linked; usage fits Authentication, Database and Hosting quotas.
- [ ] New rules and frontend are deployed together; old cached clients fail safely and users receive the new URL.
- [ ] Developer mailbox receives a test support message sent by you; privacy notice and retention procedure are school-approved.

Record tester, date, browser/device and outcome beside each item. A failed security/data-integrity item blocks release. Keep the restrictive rules and use maintenance mode while fixing a blocking regression.
