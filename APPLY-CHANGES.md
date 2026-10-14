# Apply the upgrade safely

**Current status:** this upgrade was deployed on 14 October 2026. Read DEPLOYMENT-STATUS.md first; the installation commands below are retained for future updates and recovery.

Developer/contact: **SANCHEZRAMIL2202@GMAIL.COM**. The commands below are for PowerShell, run from the extracted `CSTR-Reviewed-2026-10-13` folder. Replace placeholders only where stated. Do not paste real passwords, student records, account codes, service-account keys, or database backups into a public repository or chat.

## 1. Understand the compatibility change

The supplied Firebase project configuration remains in `website/ASSETS/firebase-sync.js`. The public Firebase web API key identifies the project; database rules and Authentication enforce access. Never put an Admin SDK service-account key in `website/`.

The record structure remains version 4. Grading calculations are preserved. Successful saves add `_syncProtocol: 2`, a monotonically increasing `_syncRevision`, a server save timestamp and a tab identifier. Existing records without a revision begin at revision 0; their first successful new-client save uses revision 1. Do not manually reset revisions.

Existing approved accounts and verified legacy bindings remain supported. The public client cannot create approvals, registration tickets or legacy bindings. New account creation creates only a Firebase Authentication identity. The developer must approve access separately. The old site will be unable to write after the new rules are published. Coordinate rules and frontend deployment; ask teachers to save and close old tabs first.

## 2. Contain the previously exposed account codes

1. In Firebase Console, select `cstr-class-record-global`. Confirm that this is your intended project.
2. Tell teachers to save current work and stop editing during the upgrade window. Ask them to retain private exports of critical classes.
3. Open Realtime Database → Data. Export the entire database to a **private** local backup. Record the backup time. Store it outside `website/` and outside public Git working trees. Protect it with an encrypted drive or archive. This console export is plaintext and includes learner records.
4. Save a private copy of the existing database rules for diagnosis. Do not later restore unsafe rules as a shortcut.
5. Verify each existing account UID and record ownership against your independent faculty records. An old account code is not proof of identity. Review unexpected accounts, approvals and bindings before preserving them.
6. Reset any Firebase Authentication password that was an exposed legacy code. Use Firebase password-reset links and let the account owner choose a new unique password. Protect your own Google/Firebase administrator account with MFA. Review project members and remove unauthorized access through the console after verification.
7. Replace the public setup documents that disclosed codes with this package's documentation. Removing the latest file does not remove Git history, caches, forks or clones. Treat those codes as permanently disclosed. If Git history needs cleanup, perform it separately with a repository backup and coordinate collaborator re-cloning; do not rely on history rewriting to restore secrecy.
8. Publish the new restrictive rules as soon as ownership review and backups allow. Do not leave the older public claim flow enabled while planning cosmetic changes. If an immediate incident requires stopping access, use a temporary deny-all ruleset and an announced maintenance window, then restore access only with the reviewed rules.

## 3. Approve teachers using Firebase Console

For a new email/password user:

1. The teacher chooses **Create account** on the revised site. A password of at least 12 characters is required by the UI. Account creation signs them out and explains the approval process.
2. They email the developer from their sign-in address requesting approval. They must not send their password or learner data.
3. Verify the teacher through the established school channel. In Firebase Console → Authentication → Users, find that email and copy its exact UID. Do not infer the UID from a display name.
4. In Realtime Database → Data, create the child `cstr-registration-approved/<UID>` with a boolean value of `true`, or an object containing your approval metadata. Only the Firebase administrator performs this step.
5. The teacher signs in again and creates a workspace. The frontend can create a profile only for that user's UID and only after approval. For a new workspace, the profile's `dataKey` equals the UID and `isLegacy` is false.

For Google users, their first sign-in creates an Authentication identity but access is denied until you approve its UID. They then repeat Google sign-in. A pending approval message is expected.

**Revocation:** remove the entire `cstr-registration-approved/<UID>` node. Setting it to `false` does not revoke approval because the compatibility rules check existence. Disable the Authentication user and revoke sessions using your authorized administrator workflow if the account is compromised. The old registration-ticket route cannot grant approval again under the new rules.

Configure the Firebase Authentication password policy to match the 12-character UI minimum where available. The client minimum alone is not a server-enforced password policy. Keep email/password and Google enabled only if you use them. Confirm email action templates and authorized domains.

## 4. Reconnect verified older records

Do not ask a teacher to enter an old account code into the website. Do not move or delete their data merely to change sign-in.

After privately verifying the exact UID, email and existing record key, use the Firebase Console to create or confirm:

- `cstr-registration-approved/<UID>`: `true`.
- `cstr-class-record-bindings/<EXISTING_RECORD_KEY>`: an object with `boundUid` equal to the verified UID. Optional `boundEmail`, `boundName` and `boundAt` document your verification.
- `cstr-class-record-users/<UID>`: an object with `dataKey` equal to that existing record key, `name`, `email`, and `isLegacy: true`.

Keep `cstr-class-record-data/<EXISTING_RECORD_KEY>` intact. If the existing record key already equals the UID, set `isLegacy: false`; no binding is needed. If a UID already has another workspace, stop and reconcile both copies privately. This package does not merge two teachers or two workspaces automatically.

For more than a few mappings, the optional local preparation tool checks missing records, duplicate IDs and conflicting existing ownership:

```powershell
node tools/prepare-owner-mapping.cjs "C:/private/private-backup.json" "C:/private/verified-owners.json" "C:/private/owner-patch.json"
```

Copy the example mapping format, replace every placeholder, and set `ownershipVerified` to true only after actual verification. The output is a **multi-location patch**, not a complete database. Review it privately. The tool does not publish it. Apply each listed path carefully through the console, or use a separately reviewed, authenticated administrator `update()` workflow. **Do not import that patch at the database root**: the console's JSON Import operation can replace data and does not mean multi-location update.

A later move from legacy record keys to UID record keys can be done during a separate backed-up maintenance window. It is not required to secure this release, and this package does not silently move existing records.

## 5. Test locally

Install a supported Node.js LTS runtime from the official Node.js website if needed. No website build step is required.

```powershell
node tests/run.cjs
node tests/render-smoke.cjs
node tests/export-smoke.cjs
node tools/preview.cjs
```

Open `http://127.0.0.1:8765` in your browser. Stop the preview with Ctrl+C. Local preview still contains your production Firebase configuration: view sign-in and public pages freely, but use only an expressly designated synthetic test account for authenticated acceptance testing. Never use real learner records to test deletion or conflict handling.

To test actual database rules without production access, use the Firebase Emulator Suite with the demo project ID. Install development dependencies in this package's root, never in `website/`:

```powershell
npm install --save-dev firebase-tools firebase @firebase/rules-unit-testing
npx firebase-tools emulators:exec --only database --project demo-cstr-review "node tests/firebase-emulator.cjs"
```

Use the Java version required by the current Firebase Emulator Suite. These optional tools are free. Keep the generated package lock when sharing a tested development setup. The demo ID and emulator host prevent this test script from reading production records. This script tests rules, not the complete sign-in UI. See the acceptance checklist in TEST-RESULTS.md.

## 6. Deploy without a paid server

Recommended: Firebase **Hosting**, the static hosting product, on **Spark**. Do not select App Hosting, Functions, Cloud Run or a billing upgrade. Use the free project domain; a purchased domain is unnecessary.

1. Confirm the Firebase project remains on Spark with no billing account linked. Check database, Authentication and Hosting usage in the console.
2. Keep the package folder structure intact. The supplied `firebase.json` publishes only `website/`. Private backups and tools must never be copied inside that directory.
3. Install/use the Firebase CLI and sign in as the authorized project administrator:

```powershell
npx firebase-tools login
npx firebase-tools projects:list
```

4. Confirm the listed project ID is `cstr-class-record-global`. The frontend is configured for that project. To use a different project, copy that project's web configuration into `website/ASSETS/firebase-sync.js`, create its database and Auth providers, and change both command project arguments. A different database will not contain your old records automatically.
5. Backups, ownership checks and release tests must be complete before the production deploy. Then publish restrictive rules first and the new frontend immediately afterward:

```powershell
npx firebase-tools deploy --only database --project cstr-class-record-global
npx firebase-tools deploy --only hosting --project cstr-class-record-global
```

The CLI's success message is necessary; do not treat a command being started as deployment success. Inspect the deployed rules in the console and open the actual Hosting URL printed by the CLI.

6. Check Authentication → Settings → Authorized domains. Ensure your actual Hosting domain is authorized for Google and email actions. Verify the Google sign-in popup and reset-email link on the deployed domain. Do not add unrelated domains.
7. Ask teachers to hard-refresh or close old tabs. Confirm the new approval/recovery wording, developer email and visible primary buttons. Cached old clients will fail revision validation instead of overwriting newer records.
8. After the new site passes acceptance, update the repository README/site link to the new Hosting address. If GitHub Pages was your old frontend, retire or replace its stale deployment so users do not keep opening the old client. Keep repository source management separate from production hosting.

To update source in GitHub, copy this package's root layout into a reviewed branch, retaining `website/`, `firebase.json` and the rules file together. Remove or replace the old root website/setup documents in that branch after backing them up privately. Review the diff before merging. Do not upload real backups or verified-owner files. No repository push was performed by this delivery.

## 7. Teacher recovery and daily use

- Confirm the school-approved grading mode, subject weights and activity rules before entering scores. Blank scores, numeric zero and attendance codes have different effects.
- The Home page prioritizes classes. Optional profile fields are under **Teacher profile and optional details**.
- The grade sheet offers **Entry view → One learner** for a stacked card layout. Return to the full sheet for dates, HPS and spreadsheet-style block operations.
- Use Settings → **Download encrypted backup** before major edits, term changes or account migration. Choose a separate passphrase of at least 12 characters and store it safely. The developer cannot recover it. Downloaded `.cstrbackup` files contain AES-GCM ciphertext; ordinary Excel/PDF/Word exports are unencrypted.
- Restore imports replace the whole workspace after confirmation and enter the normal autosave path. Back up the current workspace first. Imports larger than 25 MB are rejected.
- If another device saved first, Settings offers a whole-version choice. Download backups of both local and conflicting cloud versions before choosing. There is no automatic cell-by-cell merge. Another intervening save is still rejected by the revision check.
- Drafts and eight checkpoints use session storage. They are cleared for the current account on logout. Browser session restoration can preserve a tab, so always log out on shared devices. Old persistent recovery for the signed-in account is moved into tab storage when read. Previously stored recovery for other accounts can remain until those accounts sign in or the browser's site data is cleared.
- To clean a shared browser comprehensively, first export needed encrypted backups, log out, then use the browser's Clear site data control for this site. This affects all accounts and settings stored under that origin.
- **Discard unsaved changes and log out** deletes the current account's local recovery. Use the logout dialog's backup button first if cloud saving is unavailable.

## 8. Rollback and troubleshooting

**Rules deployed but old page appears:** hard-refresh, verify the Hosting URL and ensure the new `website/` was deployed. Do not loosen revision validation to accommodate the old page.

**Permission denied:** check approval-node existence, exact UID, profile `dataKey`, verified binding, and correct Firebase project. Do not set root `.read` or `.write` to true. A console administrator is expected to manage approval and bindings; the website is intentionally unable to do so.

**Conflict on save:** review and back up both versions in Settings. The transaction rejects outdated revisions rather than silently replacing the current cloud copy.

**Export cannot load:** check the network, vendor files and Nimbus fonts, then retry. Libraries are local files loaded on first export. Confirm the principal and teacher names; the principal name is intentionally blank rather than hard-coded to an unverified person.

**A frontend regression appears:** stop editing and retain private backups. Fix/redeploy the reviewed frontend or use a maintenance page. Keep restrictive rules active. The original frontend cannot safely save under this protocol. A compatible frontend rollback is acceptable; reopening public legacy claims is not.

**Data restoration is required:** restore only the affected, verified account after retaining both present and backup copies. Reconcile revisions and ownership while clients are closed. A root database import can overwrite every teacher's records; it is not a routine rollback step.

## 9. Capacity and remaining owner decisions

Firebase documents Spark RTDB limits of 1 GB stored data, 10 GB/month downloaded data and 100 simultaneous connections. Browser tabs can consume separate connections. Whole-workspace synchronization remains in this release, so large classes and many connected devices can consume bandwidth. Monitor usage; stay within free limits rather than enabling billing. Hosting and Authentication have their own quotas and service policies. No unlimited-capacity or “free forever” promise is made.

You still need to confirm the school's grading policy and permission to process learner data, establish a cloud retention/deletion schedule, review who can administer Firebase, complete the real browser/Firebase acceptance tests, and publish the chosen retention period. The provided contact address is active text in the site; mailbox ownership and delivery were not tested.

Official references: [Firebase Hosting setup](https://firebase.google.com/docs/hosting/quickstart), [Realtime Database billing](https://firebase.google.com/docs/database/usage/billing), [Realtime Database limits](https://firebase.google.com/docs/database/usage/limits), [Realtime Database Emulator](https://firebase.google.com/docs/emulator-suite/connect_rtdb), [Firebase web API keys](https://firebase.google.com/docs/projects/api-keys).
