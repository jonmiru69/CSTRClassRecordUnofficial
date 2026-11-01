# Android release results — 1 November 2026

Android **1.0.14**, version code **10014**, is published with the GitHub Pages website. The website's **Get Android app** dialog displays the version, size, installation steps, account requirements and download verification information. The website and APK use the existing Firebase project.

- Website: https://jonmiru69.github.io/CSTRClassRecordUnofficial/
- Signed APK: https://jonmiru69.github.io/CSTRClassRecordUnofficial/downloads/CSTR-Class-Record-1.0.14.apk
- Live release feed: https://jonmiru69.github.io/CSTRClassRecordUnofficial/downloads/latest.json
- Merged implementation: https://github.com/jonmiru69/CSTRClassRecordUnofficial/pull/2
- Final build and deployment: https://github.com/jonmiru69/CSTRClassRecordUnofficial/actions/runs/41285052267

## Release identity

| Field | Verified value |
|---|---|
| Application ID | `ph.cstr.classrecord.unofficial` |
| Android minimum | Android 7.0 / API 24 |
| Compile and target SDK | 36 |
| Final runtime source | `11b3b8469d7ea522f4a5449b3e7f6fa3cabae489` |
| Release commit | `4676493` |
| Published | 1 November 2026, 3:32:39 PM Asia/Manila |
| APK bytes | 6,031,029 |
| APK SHA-256 | `d4bc3ab8dcb593c508ee1a170ba21eb2dfc8ccfcb6fd354dc58ef1d1550713d0` |
| Signing certificate SHA-256 | `6165547ce8e01e34cfae21dcdc394e002e915d20f3a8ba3d70a38004cfd4007e` |

The published APK was downloaded over HTTPS, checked against the live feed's byte count and SHA-256, and verified locally with Android's apksigner. APK Signature Scheme v2 verification passed with one RSA-3072 signer and the expected persistent release certificate. Scheme v3/v4 and SourceStamp are not present; they are not represented as verified. The production workflow separately verifies the actual package ID/version using aapt before publication.

All four signing secrets are configured in encrypted repository Actions secrets. Private key material/passwords are outside Git, the public site and the source archive. The owner must retain the private backup described in RELEASE-GUIDE.md to preserve future update compatibility.

## Validation results

| Area | Evidence |
|---|---|
| Core behavior | 26 checks passed, including grade boundaries, attendance/blanks, recovery, stale writes and declared rule expressions |
| Existing UI regression | Template rendering smoke checks and 12 October 24 regression checks passed |
| Score adjustments | 15 provenance, reversal, lock and normalization checks passed |
| Mobile/update/file delivery | Three suites passed: release rejection/urgency, phone rendering/indices/locks/escaping, and awaited native sharing/cancellation |
| Export binaries | Excel serialization, Word ZIP/document content, SVG page generation and actual PDF binary/font-stream checks passed |
| Full PDF layout | Actual five-page synthetic browser export rendered by Poppler with zero stderr; all five rendered pages inspected |
| Android build | Final `assembleRelease lintRelease` completed successfully; earlier review builds also compiled debug and unsigned release variants with lintDebug |
| Deployment | Both Android and GitHub Pages deployment jobs completed successfully |
| Live assets | Deployed HTML references the expected committed content hashes for app-install.js, mobile.css and official-egradesheet.js |
| Live release feed | HTTPS success, CORS `*`, and valid 1.0.14 metadata; feed accepts an upgrade from 10013 and rejects a prompt for current 10014 |

The original grading engine and declared Firebase database rules are unchanged from the audited baseline. Existing tests were corrected where their expected blank-score treatment and stale source hash contradicted the actual baseline engine; the engine was not changed to satisfy those assertions.

Browser acceptance used invented records at 320px with 200% root text, 390px portrait, 844×390 landscape, 768px tablet and 1440px desktop. It checked invalid-score correction, filtering, Enter advancement, attendance codes, locked periods, settings/recovery, large-text wrapping, focus clearance, valid updates, malformed/wrong-key feeds, notification denial and saving before update. Owner-authorized live sign-in reached the actual overview and grade sheet read-only. Live class records, approvals and ownership mappings were not edited.

## Update behavior

A source patch pushed to main starts the signed release pipeline. A successful publication makes the update available; a repository edit alone cannot change an already installed APK. Documentation-only and generated-download commits are excluded. Superseded source builds skip publication, and a failed build/signature check cannot publish an unsigned update.

Installed applications check at launch, resume, reconnection and every five minutes while visible. Newer valid releases create an update modal and persistent banner urging the teacher to save and update promptly. Optional background checks request a 15-minute WorkManager interval and need notification permission for alerts. Android battery/Doze/force-stop/network conditions can delay checks. The public feed currently has GitHub Pages' `max-age=600` response header; clients request uncached reads, but network/CDN delivery remains another reason not to promise instantaneous notification.

Pending edits/saves block starting the update until preserved. Downloads open outside the WebView and Android performs the user-approved installation. Keep the app installed and install the update over it; uninstalling removes app-private recovery. No silent installation or mandatory data-destructive update is implemented.

## Practical limits and rollout

No paid service, credit card enrollment, billing upgrade, new database or app-store registration was introduced. Standard public-repository GitHub runners and the existing GitHub Pages/Firebase setup are used; their normal free quotas still apply. The separate Firebase Hosting frontend was not republished.

Physical Android installation, an upgrade over an existing signed install, actual IME/safe-area behavior, TalkBack, native export destinations and background notification delivery still need device acceptance. No physical device or emulator result is claimed. The embedded browser displayed the correct live download dialog, but its automated download event timed out; the public APK itself was successfully fetched and verified separately over HTTPS. Complete real-phone installation before broad faculty rollout.

The design skill's final inspector produced 9 failures and 3 warnings, chiefly marketing-only photography/motion/headline criteria and retained table/form details. This is not a passing marketing inspection. The skill excludes app screens; its applicable hierarchy, spacing, typography and screenshot review were used alongside the mobile conversion skill. The actual teacher workflow retains functional form/table conventions.

Build logs contain upstream Node/Gradle deprecation messages and a Capacitor lint-baseline notice about entries no longer found. The release build/lint jobs succeeded; this report does not claim warning-free third-party tooling or an independent line-by-line vendor audit.

See SYSTEM-AUDIT.md for architecture and mechanisms, RELEASE-GUIDE.md for installation/maintenance, and the generated source inventory/reference appendix for file hashes, function locations and exact grading catalogs.
