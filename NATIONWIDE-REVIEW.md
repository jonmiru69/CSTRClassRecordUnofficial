# Nationwide Class Record review candidate

Baseline `226c2fb4e5ed1e31ab39cee7a179fc5ef1a9c2cd`. This change can be reviewed entirely on a local machine using synthetic data. The default Hosting build shows the neutral landing and Grade 6 Science practice. Production signup and private record access require separate review.

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
- Candidate rules reject inactive legacy approvals, unknown top-level fields, malformed nested values and oversized string fields. They accept known v4 approval forms and preserve v4 path names and revision semantics. Verify compatibility against the actual institutional shapes before releasing these rules.

## Release gates

| Scope | Evidence required before release |
|---|---|
| Closed public preview | Owner approval for the new landing and URLs. Validate production Hosting headers, existing faculty access and signed Android upgrade on a record-free account. |
| Candidate RTDB rules | Read-only confirmation of current deployed rules and v4 approval, binding and data shapes. Reproduce compatibility in the emulator from redacted structural fixtures. Review all actual shape exceptions before deploying. Existing records and account mappings stay in their current locations. |
| Neutral self-service | Owner approval, verified Spark status and headroom, Auth authorized domains/providers and mail checks, reconciliation of former or held identities, and permission to publish each directory row. A verified school catalog and its redistribution evidence are still required. An empty live catalog falls back to private school entry. |
| Private Grade 6 Science | Written school policy and storage approval, an expiry-bound grant for the UID and school, proof of access and retention controls, and a staged capacity test. The candidate exposes a single approved-policy slot for review. Other school policies require separate versions and tests. |
| Identifiable public-school data and official formats | Institutional authorization, logged access, and official submission evidence under DepEd Order 015 §61. Verified issuer, reuse rights, native Excel parity and school acceptance for each workbook. The candidate has no public identifiable write path and cannot grant this through profile settings. |

The build flag `CSTR_NATIONWIDE_MODE=pilot` activates the neutral Auth adapter on the canonical HTTPS host. The separate operator-owned booleans `nationwide-v1/control/registration` and `nationwide-v1/control/privateRecords` must each be explicitly enabled when their release conditions are met. Until then use the default build. Emulator mode is restricted to loopback and supplies synthetic directory fixtures.

The first public release is Hosting only. The closed web build and Android bundle retain the faculty approval check used by the deployed v4 rules. Build the default web package and deploy only Hosting to `cstr-class-record-global`. Move to the stricter pilot approval check after verifying production approval shapes and releasing compatible rules separately.

Admin scope uses `nationwide-v1/holds/<uid>` and `nationwide-v1/privateGrants/<uid>/<school-key>`. Check the owner UID, expiry and school-confirmed scope before setting a grant. The supported private grant uses `active: true`, `sector: private`, `schoolName`, `schoolYear`, `curriculum`, `grade: 6`, `subject: Science`, and `policy: private-g6-science-v1`. These are privileged records and the browser cannot set them. The permitted record namespace has at most 12 class slots per school context, 60 learners per class and 11 assessments per term.

For the shared school catalog, run `node tools/import-school-directory.mjs approved-source.json new-output-directory` with a source snapshot date, official URL, rights evidence, and reviewed rows. The importer accepts School ID, name, sector, locality, region, region label and aliases, and publishes coverage per shard. It excludes contacts and learner data. Review the generated manifest and copy the approved shards into the package only after authorization.

## Rollout and rollback

Keep the production plan on Spark. Preserve the current release and download manifest as the recovery point. Review the source patch before any branch or Hosting change. Prepare the old-account structural checks and owner authorization before publishing candidate rules. The GitHub workflow now requires a manual publication input on main before signing or pushing an APK and deploying the web builds. Its ordinary checks can run without those credentials.

For a bounded pilot, measure current connection count, database downloads, Hosting transfer and verification mail before inviting anyone. Keep the proposed 20-teacher pilot below 40 added simultaneous connections. Pause invitations when the projections exceed 60% of the smallest relevant free quota. Keep the v4 and new namespaces separate.

To pause the rollout, turn off registration first. If a private pilot must stop, close that record gate and retain the stored pilot records for authorized recovery. Restore the previous Hosting release if its UI must return. Keep issued Auth UIDs and both record namespaces in place. Restore access only after resolving the specific cause and reviewing recoverable drafts. Do not run a database overwrite or attach a new account to an old record.
