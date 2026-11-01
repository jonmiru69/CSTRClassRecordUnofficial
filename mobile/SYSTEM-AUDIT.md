# CST-R Class Record: system audit and Android conversion

Audit date: 1 November 2026, Asia/Manila. Baseline repository: `jonmiru69/CSTRClassRecordUnofficial`, commit `bdb4f84`. This report describes observed implementation, rather than certifying school grading policy, security compliance, or physical-device compatibility.

## Scope and evidence

The review covered the repository structure, authored application modules, grading functions, record operations, storage and synchronization, authentication and approval, exports, accessibility enhancements, stylesheet cascade, hosting configuration, existing tests, and the new Android packaging/update pipeline. Vendored distributions were inventoried and their integration inspected; this is not a line-by-line independent audit of the Firebase, ZIP, PDF, spreadsheet, Word, or Capacitor libraries themselves.

The owner-provided sign-in was used to reach the live overview and grade sheet. Live learner scores, rosters, classes, ownership mappings, approvals and database rules were not edited for testing. Editable browser tests used an isolated local fixture containing invented records. No supplied account password is included in the source, report, APK, tests, or release pipeline.

The user narrowed the target to **Android APK**. Native iPhone distribution is outside this release. The existing website remains a usable client of the same Firebase records.

## Existing architecture

This is a static client application, not a server-rendered site. `index.html` loads local styles and classic JavaScript modules. `app.js` owns the application state, HTML rendering and delegated input/action handlers. There is no routing framework or application server. The application switches among Overview, class selection and a selected class record in memory; dialogs supply settings, searches, exports, confirmation and recovery.

The existing backend is Firebase Authentication plus Firebase Realtime Database. The Firebase compat SDK is self-hosted in `ASSETS/vendor/firebase-compat.bundle.js`; the repository identifies it as SDK 10.14.1 with app/auth/database modules. Local export libraries are loaded only when needed. The project already includes its school workbook template, school crest, campus image and local fonts.

The browser origin stores non-sensitive theme/sidebar preferences in local storage. Current-account draft state and a maximum of eight recovery checkpoints use session storage. Firebase owns authentication tokens. Downloads are separate files; the ordinary Excel, PDF, Word and learner-image exports are not encrypted by the application. The passphrase-protected backup is a different format.

### File responsibilities

| Source | Responsibility |
|---|---|
| `index.html` | Bootstrap order, viewport, application mount, policy dialog, enhancement wiring |
| `ASSETS/app.js` | State normalization, views, editing, selection, saves, conflict choices, account dialogs and exports |
| `grading-engine.js` | Pure grading calculations, subject presets, roles/domains, transmutation and descriptors |
| `record-tools.js` | Score provenance, HPS adjustments, row categories, completion and period labels |
| `firebase-sync.js` | Firebase configuration, provider sign-in, profiles, subscriptions and revision transactions |
| `registration.js` | Approved-account checks and pending email account creation |
| `backup.js` | Backup validation, PBKDF2/AES-GCM encryption, passphrase UI and restore import |
| `stable-dom.js` | Keyed DOM patching that retains fields, selection and scrolling |
| `asset-loader.js` | Lazy local loading of Excel, ZIP, PDF/font and Word libraries |
| `school-excel.js` | Fills the native OOXML school template, preserving its structure and print settings |
| `excel-export.js` | Workbook ZIP processing and download delivery |
| `official-egradesheet.js` | Official-format page layout and PDF/Word generation |
| `theme.js` | Explicit theme preference and system-theme fallback |
| `apple.js` | Native HTML policy-dialog behavior; despite its name, this is not an iPhone app |
| `review-accessibility.js` | Modal focus containment, inert background, Escape and popup positioning |
| `interaction-polish.js` | Existing action-label emphasis and control enhancements |
| `firebase-database-rules.json` | Declared database authorization and revision validation |
| `firebase.json` | Existing Firebase hosting/rules/emulator configuration |

Styles load in a deliberate override chain: design-system, review, workspace, revisions, UI refinements, sheet emphasis, then the new mobile stylesheet. Earlier files contain legacy rules and `!important` declarations. A responsive change must be checked against the final computed styles; changing a token or adding a low-specificity rule alone does not establish the rendered result.

## Data model and period behavior

The state schema is version 4. Its main fields are `teacher`, `photo`, `registry`, `sections`, `calendarMode`, `trimesterModeSeen`, `registryTri` and `sectionsTri`. A brand-new account begins with an empty class registry. The application does not insert demonstration classes into real accounts.

Each class has its own ID, school group, level, subject, optional grading category, section, three component weights, grading mode, display theme, roster size and archive flag. A class's section bucket contains grading periods. The quarterly/semestral and trimester modes have separate registries and records. Switching calendars therefore changes the active record set; it is not merely a change in the period labels.

Each period holds its name and relevant quarter/semester/term identifiers, a lock flag, date arrays, HPS arrays, activity metadata and a learner roster. Each learner has a name and WW/PT/QA score arrays. Activity metadata includes title, competency, topic and assessment role/domain. Learner objects also carry HPS recovery provenance and score-adjustment histories.

The initial period allocates 10 WW, 8 PT and 3 QA columns and normally 50 blank learner rows. These are editable capacities, not 50 pre-existing learners. Normalization aligns arrays and fills missing compatible fields. Trimester naming is capped to the configured three terms. SHS period labels include semester/quarter context. Classes can be archived separately from permanent deletion.

Explicit boys/girls/strand headings are distinguished from learner rows. Personal names such as “Boysen” or comma-separated names must not be silently interpreted as headings. Category rows do not receive ordinary learner deletion/score treatment. In the phone assessment view, filtering uses original roster indices so a filtered row still edits the correct learner.

## Grading mechanism

All clients call the existing pure grading engine. The conversion does not implement a second mobile formula. The baseline engine is unchanged; the regression suite compares its normalized source bytes with the audited baseline.

For an ordinary component, raw totals are divided by applicable HPS totals, expressed as a percentage, then multiplied by the component weight. The initial grade is the sum of the three component weighted results. A zero-weight component contributes zero without requiring assessment results.

The engine's active-activity rules are particularly important:

| Value/condition | Implemented treatment |
|---|---|
| Numeric `0` | Entered score; included in totals and completion |
| Blank mark with configured positive HPS | Counts as zero for provisional calculation and remains missing for completion |
| Blank score and blank HPS in an unused column | Column does not count |
| A / M | Absent/missing; zero against the activity HPS |
| E / L | Excused/late; activity excluded for that learner |
| Negative, non-numeric unrecognized value, or score over HPS | Invalid; correction is required |
| Active activity with invalid/non-positive HPS | No valid component result |

The general QA grouping uses ST1/ST2/TE at 30%/30%/40%. A group pools its raw marks and HPS before its share is applied. Required groups/domains must be configured; the engine does not silently turn a missing group into equal weighting. Learner-specific E/L exclusions remove the corresponding denominator; remaining applicable group shares are normalized. TE-only subjects and zero-exam subjects are separate cases. GMRC/Values rules use their configured cognitive/affective/behavioral domains.

Display rounding is separated from calculations. Initial-grade display uses three decimal places. School transmutation uses the precise result, with twelve-decimal normalization for binary arithmetic noise, rather than promoting a value based on its rounded display. Explicit zero-based grading reports the configured integer rounding instead. The exact source presets and threshold table are supplied in the generated reference appendix.

The descriptors implemented in this repository are Advancing (90+), Benchmarking (80–89), Connecting (75–79), Developing (65–74) and Emerging (below 65). These names and the supplied subject/weight catalog describe this software's rules; their institutional approval was not inferred from the page's policy reference.

### Integrity, completion and locking are different

Completion counts named learners' valid entries against active required assessments and excludes configured zero-weight components. Orphan scores on unnamed rows prevent a false complete result. Dashboard “complete periods” uses completion; it is not a count of periods that happen to be locked.

Locking prevents subsequent editing and deletion until unlocked. The lock handler checks input integrity before locking, but locking is not itself proof that every learner's requirements are complete or that a grade has been approved for submission. A locked imported/older period can still be incomplete.

Reducing HPS caps scores that exceed the new HPS after the HPS field is committed. The previous score/HPS is retained. Raising HPS back restores the original score when the teacher has not explicitly replaced it. An explicit edit supersedes that recovery. Added points record the original raw value, each positive addition, reason, timestamp and actor; reversal archives those entries and restores the appropriate raw score. These records remain attached to the learner object through normalization, exports and synchronization.

## Authentication, approvals and ownership

Browser sign-in supports email/password and Google popup authentication. Creating an email account does not approve database access; a separate administrator approval is required. Approved accounts can provision their own profile. Existing legacy ownership is resolved by verified administrator mappings, not by treating an old account code as a password or proof of ownership.

The database rules deny access by default. Approved users may read their own approval, their own profile, and records keyed to their UID or an administrator-verified legacy binding. Clients cannot write approvals or legacy bindings. A profile cannot arbitrarily change its `dataKey` after creation. Declared record writes require schema version 4 and synchronization protocol 2 with an incremented revision, client ID and bounded server timestamp.

These are the repository's declared controls. The current task did not alter production database rules, approvals or identity mappings. Local rule-expression tests are not a deployed-rules audit or a replacement for the Firebase Emulator Suite.

### Native Android sign-in

The APK uses the existing email/password provider and the same approved Firebase identity. It does not run Google popup OAuth in an embedded WebView. A Google-only teacher can add a password in website Settings, then use that same approved account in the APK. The app can open the web workspace in the external browser. This is an explicit capability boundary; native Google OAuth has not been represented as implemented.

Firebase authentication persists in Android's private WebView storage so closing/reopening the app does not require routine re-entry. Browser authentication keeps its existing session-only behavior. Logout signs out and clears current-account recovery. School authorization and account approval requirements remain unchanged.

## Saves, conflicts and recovery

Each cloud record contains `_syncRevision`, `_syncProtocol`, `_syncSavedAt` and `_syncClientId` metadata. An account's save is a full-state transaction against an expected revision. A matching revision advances exactly once. A stale expected revision aborts rather than overwriting a newer device's state. The transaction uses the Firebase server timestamp.

An instance ID identifies a device/tab's own write echo. Subscriptions load the cloud record and deliver later remote updates. A save before initial cloud synchronization is blocked. If a remote update arrives while local edits are pending, the application holds both versions and blocks saving until the teacher reviews the conflict. The available resolution chooses whole versions; it does not merge individual cells automatically.

Typing in the same field is grouped as one logical edit until focus leaves or an idle interval ends. Existing autosave defaults are a 900ms quiet delay, eight logical changes and a three-minute ceiling after the first pending change. A recovery draft is maintained more frequently than cloud autosave. Manual Save remains important, particularly before switching devices or updating.

Initial loading has a six-second fallback path for a recoverable local draft if the database does not respond. A later successful cloud load keeps the cloud version and makes recovered local content available through checkpoints. Internet access is still needed for account approval/initial cloud access; this is not an unrestricted offline-first database or an automatic conflict merge.

### Android-specific recovery

Android drafts and checkpoints are additionally copied to app-private encrypted recovery. AES-256-GCM uses a non-exportable Android Keystore key. The encrypted file is written atomically under the no-backup files directory, and Android application backup is disabled. Authentication credentials and login flags are not copied into this recovery envelope. On restart, recovered draft/history keys are loaded before the usual approved-account/cloud initialization.

Backgrounding commits the current field, checkpoints pending work and attempts an ordinary revision-checked save when that is permissible. Successful saves and clearing recovery update the encrypted snapshot. Logout clears it. Keystore loss, uninstalling or device failure can make local recovery unavailable; an independent encrypted export/cloud save is still necessary for durable recovery. A native build log does not establish process-death recovery on every device.

Passphrase backup encryption remains PBKDF2-SHA256 with 600,000 iterations and AES-256-GCM, using a random salt and IV. Import validates schema, sizes and dangerous object properties. A forgotten passphrase cannot be recovered by the software. Backup and ordinary export files have different confidentiality properties.

## Mobile interface and screen flow

The website and APK share business logic. The phone interface changes composition and task order rather than scaling the desktop sheet down.

| Destination | Phone behavior | Back/close and retained state |
|---|---|---|
| Overview | Teaching metrics and active classes precede the profile editor | Root destination; records retained in application state |
| Classes | Readable class list/cards, JHS/SHS and archive controls | Returns to Overview |
| Class record | Compact class identity and a period picker; one assessment is the phone/native default | Returns to Classes; view edits remain in state |
| One assessment | Choose component/activity, expand shared metadata, then score a vertical learner list | Activity/filter retained while navigating the working session; original row indices preserved |
| One learner | Existing detailed report and editing flow | Remains a selectable alternative view |
| Full grade sheet | Existing two-dimensional table for deliberate wide review/editing | Explicit alternative; horizontal scrolling is intentional |
| Find | Dedicated complete-name search dialog and teacher-assisted results | Close returns to the prior view; same-name matches require class/row verification |
| More | Settings, recovery, calendar mode, theme, policies, app updates and logout | Dialog close returns to prior screen |
| Export/update | Focus-contained dialogs with explicit actions and status | Cancel/close returns to prior work |

Phone controls use 48 CSS-pixel target defaults, readable input sizes and 16px gutters. These are chosen web layout defaults, not a claim that CSS pixels equal Android dp. Inputs preserve zoom. Large labels wrap rather than overprint adjacent controls. Bottom-navigation clearance is measured from its actual rendered height, including enlarged text. Native system/IME insets belong to the Android container; web content adds clearance for application chrome.

The selected-score toolbar supplies A/M/E/L and Clear alongside the decimal keyboard. Enter advances to the next visible learner. Filtering does not renumber database positions. Invalid values have text and `aria-invalid`, not only color. Locked periods disable editing and code actions. Focus placement accounts for both the sticky save header and the lower score tools. Mobile entrance motion avoids ancestor transforms that would change fixed-position containment.

The existing crimson/ink/school-crest identity, local CSTR Sans typography and class colors were retained. The subject inventory includes the actual school crest/campus, its unofficial faculty context, JHS/SHS modes, the school's native workbook, configurable period structure, approval workflow, detailed score provenance and teacher-assisted lookup. No invented testimonials, institution approval, app-store approval, or stock product screenshots were added.

## Files and exports on Android

`CSTRFiles.deliver` is a shared delivery boundary. Browsers retain anchor/blob downloads. Android writes an app-private temporary cache file and opens the system save/share sheet so the teacher can choose Files, Drive or another destination. Broad shared-storage permissions are not requested. All existing export paths—Excel, official PDF/Word, learner PNG/ZIP and encrypted backup—reach this boundary. Sharing is awaited and failures/cancellation propagate instead of being reported as a completed browser download. Cached exports are removed on the next launch.

The existing school Excel writer edits the supplied OOXML template rather than flattening it through a generic serializer. Learner values are text rather than formulas. Official PDF/Word exports retain their own pagination and local font requirements. The conversion changes delivery, not their grading formulas or school layout. Browser/export smoke evidence and physical Android sharing are reported separately.

## Android package and update mechanism

The package ID is `ph.cstr.classrecord.unofficial`. Capacitor 8.6.0 bundles the actual static client under its local HTTPS origin, with no development server URL, mixed content or remote bridge navigation allowlist. Android targets SDK 36 and supports API 24 onward. Native source, Gradle wrapper, locked JS dependencies, icons, manifest and build scripts are included. Launcher/splash images use the existing project crest.

Linked assets in packaged/deployed HTML receive content-derived SHA-256 version queries. A website patch therefore cannot accidentally reuse an old cached application script beside a new mobile stylesheet. Web publication packages only public HTML, ASSETS and downloads; native sources, tests, dependencies and signing material are excluded.

The release pipeline builds and checks the client, generates a monotonically increasing Android version code from the workflow run number, and signs production APKs using the persistent release key. The signing material is supplied only to the production signing step on `main`. It is not committed to Git. `publish-release.mjs` invokes Android's APK signature verifier before computing file size/hash, copying the APK and writing `downloads/latest.json`. A signing-key change or lower version is refused. Website files, APK and feed are then packaged together for GitHub Pages.

An edit to source triggers a build; it does not instantly modify an already installed APK. Documentation-only edits and generated download updates are excluded from rebuild triggers. Build or signing failures do not advertise an unsigned APK as an update. A successfully published signed release is the event that makes a new app update available.

### Update timing and validation

The app checks the public release feed on launch, resume, reconnection and every five minutes while visible. A newer release creates a modal and persistent update banner. A minimum-supported version can mark a release important. Pending edits must be saved/preserved before starting the download. The Android installer remains responsible for user-approved installation and signature-compatible replacement; the app does not silently install software.

With notification permission enabled, Android WorkManager also checks periodically with a 15-minute request interval and a network constraint. Android may delay work for battery, Doze, force-stop or connectivity conditions. This is not an instantaneous push guarantee. Notifications are deduplicated for the same version, with at most a daily reminder. Denied permission leaves in-app prompts working. Notification taps reopen the app and its normal release check.

Both clients validate schema, application ID, integer version bounds, matching version/filename, size/hash fields, HTTPS and the exact supported download domain/path. The native side additionally compares the release's certificate fingerprint with the installed signing identity. Unavailable, malformed, foreign-domain, wrong-key and older/equal releases do not become actionable updates. The SHA-256 in the feed is computed from the verified published APK; the external-browser download is not independently re-hashed by the JavaScript app on each device. Android verifies the installed package signature.

## Cost and deployment boundaries

No new database, Firebase Functions, Cloud Storage upload service, SMS provider, paid app builder, Apple program, Play Store account or credit-card enrollment is needed for this Android sideload route. The existing Firebase project is reused; no billing upgrade is performed. Standard GitHub-hosted runners are free for public repositories; larger paid runners are not selected. Free-service quotas still limit capacity. The current task does not infer the live Firebase billing-plan state from an old deployment note.

The requested website is the repository's GitHub Pages address. Publishing it does not automatically update the separate Firebase Hosting frontend address. Both clients can continue using the same database; no migration or record rewrite is required. Firebase hosting exclusions were extended so a later manual mirror deployment cannot expose native sources, dependencies or signing files.

## Validation and practical limits

Automated coverage includes grading examples/boundaries, attendance and blanks, HPS reversal, score provenance, encrypted backup tampering, stale-write rejection, ownership-rule expressions, template rendering, phone roster indices/locks/escaping, release metadata rejection and native delivery cancellation. Export smoke tests inspect spreadsheet serialization, Word ZIP content and SVG page generation. Successful Android jobs compile debug and release variants and run Android lint.

Browser checks used synthetic records at 320px enlarged text, 390px portrait, 844×390 landscape, 768px tablet and 1440px desktop. They checked roster filtering, value correction, keyboard advancement, attendance tools, locked periods, settings/recovery access, update prompts, wrong-key rejection, notification denial and saving before update. Actual phone keyboard/safe-area behavior, TalkBack, physical installation/sharing and upgrading an existing signed installation remain device acceptance work; browser geometry and build/lint success do not establish those results.

The requested taste skill was used for actual screenshot inspection, hierarchy, typography, spacing and the new download component. Its marketing-page inspector was run and its diagnostics retained. It still reports marketing-specific failures such as lack of photography/video, display-scale headlines and multi-section motion, plus legacy interface details. Those metrics are not presented as passed, and extra promotional imagery/motion was not inserted into a teacher's transactional screen to satisfy them. The skill itself excludes dashboards/app screens; the applicable component and mobile review guidance was used.

## References

- [Repository and original website](https://github.com/jonmiru69/CSTRClassRecordUnofficial)
- [Capacitor installation and static-client requirements](https://capacitorjs.com/docs/getting-started)
- [Capacitor environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor Filesystem](https://capacitorjs.com/docs/apis/filesystem) and [Share](https://capacitorjs.com/docs/apis/share)
- [Android WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started) and [notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Actions encrypted secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [Firebase pricing-plan distinctions](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

Exact release, commit, verification and deployment results are recorded in `RELEASE-RESULTS.md`. The generated source inventory and reference appendix provide file hashes, function locations and the full subject/transmutation catalog.
