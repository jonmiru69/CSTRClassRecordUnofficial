# CSTR Class Record — Unofficial

Current revision: Android application, phone assessment entry, and signed update delivery. See the [system audit](mobile/SYSTEM-AUDIT.md) and [Android release guide](mobile/RELEASE-GUIDE.md). Earlier changes: [24 October UI refinements](REVISION-2026-10-24-UI.md), [24 October features](REVISION-2026-10-24.md) and [23 October revision](REVISION-2026-10-23.md).

[Open the class record](https://jonmiru69.github.io/CSTRClassRecordUnofficial/) · [Firebase Hosting](https://cstr-class-record-global.web.app/)

An unofficial teacher workspace. Confirm grading settings and submitted exports with your school.

## Operations

- [Deployment and account administration](APPLY-CHANGES.md)
- [Changes](CHANGES.md)
- [Verification and remaining acceptance checks](TEST-RESULTS.md)

Website files live at this repository root. Firebase Hosting publishes the same files with the supplied firebase.json. No paid service is required; keep billing disabled and stay within free quotas.

The GitHub Pages release workflow publishes a public-only bundle with content-versioned assets. Teachers can select **Get Android app** on the website, or **More → Android app and updates** in the mobile workspace. The APK uses the same approved account and cloud records. Google-only teachers should add a password in website Settings before signing in to the APK.

Source patches pushed to `main` build a new signed Android version, verify its identity, and publish the website, APK and update feed together. A failed build does not advertise an unsigned update. Native Google popup login and unrestricted offline cloud saves are not implemented. iPhone native distribution is outside this Android-only release.

Developer support: SANCHEZRAMIL2202@GMAIL.COM. Never email passwords or student records.
