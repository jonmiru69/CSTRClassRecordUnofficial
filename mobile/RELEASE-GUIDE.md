# Android release operations

The application and website share the existing Firebase project. Native iPhone distribution is not part of this release. No new paid hosting or database service is required.

## Teacher installation and updates

Open the GitHub Pages website and choose **Get Android app**. Download the signed APK, open it on Android 7.0 or later, and follow Android's installation prompts. Android may ask the teacher to allow installation from the downloading browser. The app itself does not request permission to silently install packages.

Sign in with the same approved email/password account. Google-only users can add a password in website Settings before returning to the APK. Creating another account does not reconnect existing records or grant approval.

Use **One assessment** for vertical score entry. Select a period, component and activity; expand Activity details to change HPS/date/title/competency/topic/role. Use A/M/E/L controls for the focused score. **One learner** and **Full grade sheet** remain alternative views. Save to cloud and check the result before moving to another device.

Android exports open a save/share sheet. Select a real destination and confirm it. The app does not claim that merely opening this sheet saved a permanent copy. Backups use a separate passphrase; ordinary reports are not encrypted by the app.

When a newer signed release is published, the app prompts on launch/resume and while open. Enable optional background alerts under **More → Android app and updates**. Android controls their scheduling; battery/force-stop/network restrictions can delay them. In-app prompts work without notification permission. Save pending changes before updating, and install over the existing app rather than uninstalling it.

## Normal source patch

Push the reviewed source patch to `main`. The Android workflow runs the tests, bundles the client, synchronizes native dependencies, builds and lints the release, signs it, verifies the APK signature and package/version, and writes the release feed from the actual APK. It then publishes the public website, APK and feed together through GitHub Pages.

The build number is `10000 + github.run_number`, and the release name is `1.0.<run_number>`. Do not decrease version codes or replace the signing identity. Documentation-only commits and generated download updates do not produce unnecessary app updates. The workflow's own release commit does not recursively launch a new build.

The release consumes four encrypted repository Actions secrets only in the production signing step:

- `CSTR_ANDROID_KEYSTORE_BASE64`
- `CSTR_ANDROID_STORE_PASSWORD`
- `CSTR_ANDROID_KEY_ALIAS`
- `CSTR_ANDROID_KEY_PASSWORD`

Keep signing material out of source, downloaded source archives, logs and chat. Maintain an owner-controlled private backup of the original signing identity. Losing it prevents compatible updates to installed APKs. The private local backup created during this task is outside the repository under the task workspace's `work/private-android-release`; it is not part of the public downloads.

## Failed builds and rollback

A failed build/signature/package check must stop publication. Do not set `available:true` for an unsigned APK or manually point a higher version at an older file. Fix the problem and trigger a new run. Read the failing job's first relevant error rather than changing grading logic to make a packaging check pass.

Revert faulty source through a new reviewed commit and publish a **higher** Android version. Installed Android applications will not accept a normal downgrade. Keep the same package ID and signing key. For a genuinely urgent compatibility fix, deliberately raise `minimumSupportedVersionCode` in the generated release policy rather than changing it accidentally. The UI urges an update while still preserving the teacher's work and access to recovery.

## Local development

Use Node 24 and the locked package versions. With pnpm 11.25:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm android:sync
```

For a website-only public bundle, run `pnpm build:web`. `site-dist` contains public files only and stamps linked assets by content. The source remains at the repository root; do not publish `node_modules`, native build directories or private key files.

`node tests/create-mobile-preview.cjs` creates an ignored local preview containing invented records. `node tools/preview.cjs` serves it at `http://127.0.0.1:8765/test-preview/index.html`. Preview fixtures and credentials must never be copied into the production bundle. The actual Android build also needs the official Android SDK and JDK; the public standard GitHub runner supplies them.

The separate Firebase Hosting frontend is not automatically republished by the GitHub Pages workflow. Keep the Firebase billing plan unchanged. Use the same reviewed public assets when maintaining that mirror; never deploy native sources or signing files.

## Device acceptance

Before broad faculty rollout, install the signed APK on a real Android device and verify sign-in, the correct existing class, score entry, save confirmation on another client, native keyboard visibility, TalkBack, system text enlargement, save/share destinations, background/resume, notification permission denial and an update over an existing install. Browser tests and successful Gradle/lint output are useful evidence; they are not physical-device test results.
