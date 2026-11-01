# Audit corrections — 1 November 2026

This change addresses all seven findings in the repository audit. The application corrections are implemented and regression-tested; hosting corrections require deployment before they protect the live website.

| Finding | Correction |
|---|---|
| H1: score meaning changes | Preserve invalid score text. Accept plain decimal strings and attendance codes; reject exponents, signs, fractions and other malformed tokens in calculation, integrity feedback and added-point operations. |
| H2: wrong class settings in lookup | Pass the entire owning class into grade calculation and completion; carry its grading mode into the report label. |
| H3: shifted export periods | Place JHS quarters, SHS semester/quarter pairs and trimester terms in their explicit slots; preserve gaps and block duplicate/invalid identities. |
| M1: incomplete official reports marked ready | Assess actual entry completion; leave final grades blank until complete, require confirmation for a provisional export and label its PDF/Word heading PROVISIONAL. |
| M2: recovery survives logout | Suppress draft persistence during logout, clear session recovery before native recovery, serialize native clears behind pending checkpoints, and preserve recovery if sign-out fails. |
| M3: divergent website deployments | Publish Firebase as the single workspace and Pages as a compatible entry plus existing Android APK/feed URLs. Publish the Pages entry only after canonical deployment succeeds. |
| M4: Pages lacks framing headers | The canonical workspace receives CSP frame-ancestors 'none' and X-Frame-Options DENY from Firebase Hosting; Pages no longer contains teacher controls. |

## Validation

- All existing application test scripts pass, plus new audit-correction and hosting checks.
- Reproductions cover invalid tokens; cross-class zero-based versus transmuted results; JHS/SHS/trimester gaps; duplicate/out-of-range periods; blank versus complete export readiness; successful/failed sign-out; and a native clear racing with an in-flight checkpoint.
- The Word and SVG export tests confirm provisional labeling; the existing PDF binary/font reload check passes.
- Web packaging, Android web bundling and the Pages entry build pass.
- Firebase Emulator Suite dependencies and `pnpm test:rules` are now declared, locked and run by CI with Node 24 and Java 21. The local machine has no Java runtime, so the local emulator attempt stops before starting a database.
- No real teacher records were modified and no production database rules were deployed.

## Deployment requirements

Configure repository secret `FIREBASE_SERVICE_ACCOUNT_CSTR_CLASS_RECORD_GLOBAL` with a service account permitted to deploy Hosting for `cstr-class-record-global`. Production release fails before signing/committing an APK if this secret is absent. This workstation also has no Firebase CLI login; production deployment cannot be claimed from local build results.

Run CI on the repair PR. After the emulator and Android build/lint checks succeed and the deployment credential is configured, merge the reviewed changes to main. The release workflow packages the current app, deploys Firebase, then publishes the Pages entry and compatible APK download paths. Verify the canonical response contains `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'` and `X-Frame-Options: DENY`, and that the old Pages entry opens the canonical site. Existing Android versions continue to use their original feed/APK URLs.

Web authentication is origin-specific. Save/export any pending work on the old origin before moving to the canonical URL, then sign in with the same approved account. Successfully saved cloud records use the same Firebase database and account mapping.

An approved disposable account is still needed for an authenticated two-device browser walkthrough. A physical Android device is still needed for process-death recovery, update install and notification acceptance tests. Institutional grading policy and actual Excel/Word print appearance still require their respective authoritative reference and applications. These checks are not represented as completed by the automated suite.
