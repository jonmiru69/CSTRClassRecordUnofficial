# Nationwide Class Record review candidate

Faculty baseline `226c2fb4e5ed1e31ab39cee7a179fc5ef1a9c2cd`. The default Hosting build supports the neutral landing, verified teacher signup, school profiles and Grade 6 Science practice. Signup and learner-record storage have separate controls. The complete flow can be tested locally with synthetic data.

## Run the review

Use Node 24, the repository lockfile, and the existing Java and Chrome tools used by CI.

1. Run `pnpm install --frozen-lockfile --ignore-scripts`, then `pnpm test`, `pnpm test:rules`, `pnpm test:visual` and `pnpm test:onboarding`.
2. Run `pnpm build:web`, then `node tools/preview-nationwide.mjs` and open the loopback URL printed in the terminal. Choose **Try a practice class**. Test a blank score, a recorded zero and the 70.00 cutoff. View the gradesheet and download a workbook or Word report.
3. On a machine with desktop Excel, run `powershell -File tools/check-practice-excel.ps1` after the browser tests. This opens the generated synthetic workbook read-only and checks recalculated grade boundaries.
4. Use `pnpm build:pages` after the web build and `pnpm build` for the Android web bundle. A physical device is required for a signed upgrade rehearsal. Keep the existing signing key and APK lineage under owner control.

## What the candidate enables

- The neutral landing uses the supplied Class Record seal. The existing faculty entry is at `/cst-r/`, and the Pages entry leads there. The Android bundle retains the legacy source entry.
- The standalone synthetic Grade 6 Science worksheet uses three terms and the applicable 20/50/30 weights with 30/30/40 exam shares. It applies inclusive conversion cutoffs and withholds grades on unresolved required scores. XLSX, Word and print/PDF paths are supplementary.
- The neutral account path supports verification, reset, provider linking, private school setup and a tab-only re-encoded logo. The browser emulator validates the complete email registration path and the separate faculty sign-in. Google provider behavior and outbound mail must be checked through the owner-approved production configuration.
- An approved private Grade 6 Science grant can activate a bounded class workspace with class/term editing, revision-checked saves, archives and encrypted class backup/restore. School settings are separate from trusted grants. The candidate validates authorization on the server and partitions data by owner, school and class.
- The signup release adds rules under `nationwide-v1` and retains the existing faculty rules. The separate v4 hardening review rejects inactive legacy approvals, malformed nested values and oversized fields. Generate those review rules with `node tools/generate-nationwide-rules.mjs --review-legacy` and test them in the emulator before considering them for production.

## Release gates

| Scope | Evidence required before release |
|---|---|
| Neutral self-service | Owner approval, Spark headroom, authorized Auth domains/providers, synthetic verification and owner-side production mail checks. Before opening registration, compare every faculty rule to the live rules and place pre-existing Auth identities on neutral onboarding hold. Teachers can add any school to their own profile. |
| Shared school directory | Verify the source, coverage date and publication rights for each catalog shard. Private school entries remain outside the shared directory. |
| Stricter faculty rules | Verify live approval, binding and record structures and reproduce compatibility in the emulator with redacted fixtures. Keep existing records and account mappings in place. |
| Private Grade 6 Science | Written school policy and storage approval, an expiry-bound grant for the UID and school, proof of access and retention controls, and a staged capacity test. The candidate exposes a single approved-policy slot for review. Other school policies require separate versions and tests. |
| Identifiable public-school data and official formats | Institutional authorization, logged access, and official submission evidence under DepEd Order 015 §61. Verified issuer, reuse rights, native Excel parity and school acceptance for each workbook. The candidate has no public identifiable write path and cannot grant this through profile settings. |

The default production build activates the neutral Auth adapter on the two project HTTPS domains. The operator controls `nationwide-v1/control/registration` for new profiles and `nationwide-v1/control/privateRecords` for institution-approved private classes. Registration availability can be checked over HTTPS without a persistent database connection. Emulator mode is restricted to loopback and supplies synthetic directory fixtures. Use `CSTR_NATIONWIDE_MODE=closed` for a build that serves only public practice and the faculty entry.

Before opening registration on `cstr-class-record-global`, stage holds in the new namespace while its two controls are false. Deploy the tested additive rules and Hosting package. Confirm the live faculty entry and registration page, reconcile identities created before the cutover, then set only the registration control to true. The Hosting build and Android bundle retain the deployed faculty approval check.

Admin scope uses `nationwide-v1/holds/<uid>` and `nationwide-v1/privateGrants/<uid>/<school-key>`. Check the owner UID, expiry and school-confirmed scope before setting a grant. The supported private grant uses `active: true`, `sector: private`, `schoolName`, `schoolYear`, `curriculum`, `grade: 6`, `subject: Science`, and `policy: private-g6-science-v1`. These are privileged records and the browser cannot set them. The permitted record namespace has at most 12 class slots per school context, 60 learners per class and 11 assessments per term.

For the shared school catalog, run `node tools/import-school-directory.mjs approved-source.json new-output-directory` with a source snapshot date, official URL, rights evidence, and reviewed rows. The importer accepts School ID, name, sector, locality, region, region label and aliases, and publishes coverage per shard. It excludes contacts and learner data. Review the generated manifest and copy the approved shards into the package only after authorization.

## Rollout and rollback

Keep the production plan on Spark. Record the current Hosting release and download manifest for recovery. The GitHub workflow requires a manual publication input on main before signing or pushing an APK and deploying the web builds. Its ordinary checks can run without those credentials.

For a bounded pilot, measure current connection count, database downloads, Hosting transfer and verification mail before inviting anyone. Keep the proposed 20-teacher pilot below 40 added simultaneous connections. Pause invitations when the projections exceed 60% of the smallest relevant free quota. Keep the v4 and new namespaces separate.

To pause the rollout, turn off registration first. If a private pilot must stop, close that record gate and retain the stored pilot records for authorized recovery. Restore the previous Hosting release if its UI must return. Keep issued Auth UIDs and both record namespaces in place. Restore access only after resolving the specific cause and reviewing recoverable drafts. Do not run a database overwrite or attach a new account to an old record.
