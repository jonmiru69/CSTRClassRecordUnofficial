# Workspace revision — September 13, 2026

## Included changes

1. Retractable navigation with learner search, Settings, and worded Log out.
   The collapsed state is remembered; small screens start collapsed unless a
   preference is already saved. Expanded mobile navigation overlays the page.
2. Bulk-entry help, attendance codes, HPS warnings, and QA calculation guidance
   are consolidated in the small question-mark panel.
3. Opaque, joined sticky headers and a light-red Final Transmuted Grade column.
4. Full class-colored identity card: subject dropdown, large class name, actual
   learner count, and weight previews after a brief hover/focus delay.
5. Period selection/name/add/lock/delete and the print-icon Excel export are
   grouped at the bottom of the class card.
6. Automatic completion for each individual period, including SHS quarter and
   semester labels. Two SHS quarters belong to one semester. Manual locking is
   separate and remains available to prevent edits.
7. Wider workspace, compact controls, adjustable-height table, smaller sheet
   spacing, and retained horizontal and vertical sheet scroll positions.
8. Same-sheet structural changes update existing elements in place. Score edits
   update only affected values/summaries; no page reload or entry animation.
   Navigation and genuine remote updates still update the relevant screen.
9. Reversible HPS reductions with per-learner saved provenance.
10. Flat, nearly square controls and consistent line icons instead of emoji.
11. Server-authorized registration for Google and email accounts, plus
    approved-account data rules. LIVE ACTIVATION IS REQUIRED; see the setup guide.
12. The supplied replacement campus image is included unchanged.

## HPS behavior

With HPS 100 and a score of 85.50, reducing HPS to 60 makes the score 60. Raising
HPS to 80 makes it 80; restoring HPS to 100 restores exactly 85.50. Scores already
below the reduced maximum and attendance codes are untouched.

The adjustment commits when you leave the HPS field or explicitly save. Typing
is not treated as a series of destructive reductions. Local recovery snapshots
also retain the cap and original score if the browser closes mid-edit.

If you explicitly edit/paste/clear a capped score, that newer entry wins—even
when you enter the same value as the cap. The old score is no longer restored.
Restoration information follows its learner through saving and reopening.

## Automatic finalized indicator

Every named learner must have a valid entry in every visible WW, PT and QA
activity, and every visible HPS must be positive. A/M count as zero; E/L are
accepted attendance entries excluded from grade computation. Remove unused
activity columns. Blank spare learner rows do not prevent completion, but scores
entered without a learner name do. Empty rosters cannot finalize.

Changing or clearing required data immediately removes the finalized indicator.
This is a completeness check, not a guarantee that entered grades are correct.
The existing grading engine and three-slot QA weighting were preserved.

## Saving and compatibility

Existing saved record structure is retained, with optional HPS provenance and
period-identity fields. Edits made during an in-flight save remain pending for
the next save. An unverified/offline initial load cannot overwrite cloud data.
Browser storage remains a recovery aid, not a replacement for database backups.
Do not return to older application code after using HPS restoration without
checking that it preserves the new optional fields.

## Verification

Run local automated tests with Node.js 22 or newer:

```powershell
npm install
npm test
```

All 28 automated tests passed. Tests use synthetic learners and mocked authentication/database services.
They cover reversible HPS, save/reopen metadata, manual/bulk overrides,
completion, SHS chronology, stable DOM/focus/scroll, save races, offline write
blocking, search/settings, Excel generation, and server registration rejection.
The server module was also loaded against installed Firebase dependencies.

Desktop (1440 × 900) and mobile (390 × 844) layouts were checked in an isolated
browser preview. Sticky headers were checked after scrolling both axes; the
help panel, subject menu/weight preview, collapsed sidebar, and final-grade color
were inspected. A browser HPS edit changed a sample score from 70 to 60 and
restored it to 70 when HPS returned to 100. No browser errors were recorded in
that sample session.

Not yet verified: live Firebase deployment, actual OAuth popup end-to-end,
production database-rule behavior, real cross-device saves, and opening the
export in Microsoft Excel. Complete the secure-registration guide's live checks
before release. The files have not been pushed to GitHub or deployed by this task.

## Per-period rosters (learner rows)

Each grading period/quarter now has its own learner list. Editing a name,
adding rows, or deleting a row in one period does not touch the other periods
on the same sheet. A learner who stopped attending after the 1st grading keeps
their 1st grading row and grades; delete their row only in the 2nd grading.
Existing saved data loads exactly as before. The official PDF/Word export
matches learners by name across periods (no more "names differ" block), leaving
blank grades for periods a learner was not listed in.
