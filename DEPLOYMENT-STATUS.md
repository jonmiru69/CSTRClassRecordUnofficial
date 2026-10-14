# Live deployment — 14 October 2026

## Website addresses

- Original: https://jonmiru69.github.io/CSTRClassRecordUnofficial/
- Firebase: https://cstr-class-record-global.web.app/

Both use the same Firebase project and database. No billing account was added. The project reported billingEnabled=false before deployment.

## Work performed

- Authenticated to the owner's Firebase project and GitHub repository using official tools.
- Privately backed up the complete database, deployed rules, and original Git repository history before the rollout.
- Preserved existing approvals and record ownership bindings. No learner records or scores were edited during deployment.
- Checked all four stored records locally: normalization preserved teacher details, learner names, period counts and scores.
- Ran 26 automated checks, render/export smoke checks, and the real Firebase Database Emulator security suite successfully.
- Checked the live Firebase frontend against local file bytes and verified nosniff and frame-denial headers.
- GitHub Pages built commit 52b75829ee92d50f444880a444c5620808a8eaa0 successfully; its live index and critical JavaScript files match the reviewed release.
- Published the tested database rules successfully after GitHub Pages finished building.

## Using the update

1. If an old tab has unsaved work, preserve that work before refreshing. Old clients cannot save under the revised rules. Do not close an old tab containing your only copy of unsaved entries.
2. Open either website address. If the old design persists, press Ctrl+F5 after preserving unsaved work.
3. Existing approved teachers sign in with their existing account. New accounts await your approval; the site no longer allows claiming records with public legacy codes.
4. Confirm the right class and records appear. Use a synthetic class for the first save and export check; do not alter actual learner scores just to test deployment.
5. Use Settings → Download encrypted backup for a durable personal backup. Keep its passphrase separately. Drafts and checkpoints are limited to the browser tab and are cleared on logout.

## Ongoing administration

- Developer contact: SANCHEZRAMIL2202@GMAIL.COM.
- Follow APPLY-CHANGES.md for approving exact Firebase user UIDs and verified recovery. Do not infer ownership from an old public account code.
- Any teacher who reused a publicly exposed code as a password must choose a new password through the normal account recovery flow. Historical Git commits can retain old codes even after documentation is corrected.
- Keep Firebase billing disabled. Free quotas still limit capacity; this is not a promise of unlimited service.
- The downloadable package uses website/ for public files. The GitHub repository uses its root; its firebase.json and test paths are adapted accordingly.

## Backups and access

Private backups are kept in work/private inside this Codex workspace, outside the public repository and download package. Do not upload that directory. Firebase and GitHub login state is also kept under private work directories and must not be shared.

## Verification limits

Production teacher sign-in, a real-account save, mail delivery, actual Excel/PDF/Word print layouts, and school grading-policy approval still need an authorized teacher's acceptance. Passing automated and emulator tests does not establish these outcomes. See TEST-RESULTS.md for the checklist.
