# CSTR Class Record — Unofficial

Current revision: Android application, phone assessment entry, and signed update delivery. See the [system audit](mobile/SYSTEM-AUDIT.md) and [Android release guide](mobile/RELEASE-GUIDE.md). Earlier changes: [24 October UI refinements](REVISION-2026-10-24-UI.md), [24 October features](REVISION-2026-10-24.md) and [23 October revision](REVISION-2026-10-23.md).

[Open the class record](https://jonmiru69.github.io/CSTRClassRecordUnofficial/) · [Firebase Hosting](https://cstr-class-record-global.web.app/)

An unofficial teacher workspace. Confirm grading settings and submitted exports with your school.

## Operations

- [Deployment and account administration](APPLY-CHANGES.md)
- [Changes](CHANGES.md)
- [Verification and remaining acceptance checks](TEST-RESULTS.md)

Website files live at this repository root. Firebase Hosting publishes the verified `site-dist` artifact with response security headers. No paid service is required; keep billing disabled and stay within free quotas.

The GitHub Pages release workflow publishes a public-only bundle with content-versioned assets. Teachers can select **Get Android app** on the website, or **More → Android app and updates** in the mobile workspace. The APK uses the same approved account and cloud records. Google-only teachers should add a password in website Settings before signing in to the APK.

Source patches pushed to `main` build a new signed Android version, verify its identity, and publish the website, APK and update feed together. A failed build does not advertise an unsigned update. Native Google popup login and unrestricted offline cloud saves are not implemented. iPhone native distribution is outside this Android-only release.

Developer support: SANCHEZRAMIL2202@GMAIL.COM. Never email passwords or student records.

## Audit corrections and canonical hosting

The signed-in workspace is hosted at https://cstr-class-record-global.web.app/ so response headers can prohibit framing. GitHub Pages keeps Android APK/update URLs intact and serves a link/redirect to the canonical workspace; it no longer publishes a second workspace after the release workflow is deployed.

Configure the GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT_CSTR_CLASS_RECORD_GLOBAL` with a Firebase Hosting deployment service account for this project before merging the hosting transition. The release workflow deploys Firebase successfully before publishing the Pages entry. Do not remove the existing Pages workspace manually before the canonical deployment succeeds. No credential belongs in this repository.

Run `pnpm test` for local regressions. Run `pnpm test:rules` with Node 24 and Java 21+ for isolated Firebase Emulator Suite tests; this uses `demo-cstr-review`, never production. `pnpm build:web` creates the canonical site; `pnpm build:pages` creates the legacy entry plus Android downloads. Existing web sign-in sessions are origin-specific: save and back up pending work before signing in on the canonical URL. See `AUDIT-FIXES.md` for validation and remaining deployment requirements.
