# Android conversion decisions — 1 November 2026

Audited baseline: bdb4f84 on main. Android only, following the user’s clarification.

The project is deployable static HTML/CSS/JavaScript, with local fonts, Firebase compat SDK and lazy-loaded export libraries. Capacitor can bundle the actual client. A native rewrite would duplicate the grading engine and increase drift; a remotely loaded WebView would make startup dependent on hosting and would not address phone entry.

The app packages the existing client and backend integration. There is no `server.url`, remote bridge navigation allowlist, new database, paid build service, SMS auth, Cloud Storage, Functions, or billing-plan change. Android is built with the version-matched Capacitor 8 toolchain; the locked versions are in pnpm-lock.yaml. Public standard GitHub Actions runners can build without paid compute. The Firebase console’s actual billing plan and live quotas have not been independently verified.

Phone entry is a separate vertical assessment workflow: pick component and activity, review shared HPS/date/metadata, then enter learners’ scores down a list. The full sheet and individual report remain explicit alternative views. The same input handlers, grading functions, score adjustments, period locks and revision transaction apply to every view.

Native authentication uses the already supported email/password provider and retains its approved-account gate. Google popup OAuth is never run inside the WebView. Google-only teachers can add a password in website Settings, then sign in to the same approved identity in the APK; a separate external-browser link opens the web workspace. Native Google federation needs platform OAuth registration and is not represented as implemented.

Native exports write a temporary app-private cache file and open Android’s share sheet. A teacher chooses a destination such as Files or Drive. Browser downloads keep their existing behavior. APK UI must say “save or share”, rather than claim a file was saved to Downloads. No broad storage permission is needed.

Session drafts/checkpoints are copied to Android-private encrypted recovery using a non-exportable Android Keystore AES-GCM key. Restored recovery is reviewed through the existing cloud-first conflict flow. Firebase Auth persists inside the private WebView on Android, while the browser retains its existing session-only setting. Logout clears local recovery and signs out. Offline use is limited: cloud approval/initial loading require connectivity; later connection loss does not grant permission to overwrite a newer cloud revision.

Navigation: Overview and Classes are stable destinations. Find opens a dedicated search dialog; More opens account/calendar actions. Android Back closes the current dialog/popover, then returns from record to Classes and Classes to Overview; root Back asks before leaving and checkpoints before backgrounding. Filters and activity choice live in session state and are reset at account change. Phone screens scroll in the document; the score sheet alone retains intentional two-dimensional scrolling.

Visual direction: retain the project’s crimson brand, school crest, CSTR Sans and flat academic surfaces. Taste skill is applied to the new download component and visual hierarchy; functional table/form conventions remain appropriate inside the application. There is no unrelated marketing-page draw, decorative photography quota, or motion quota for app screens.

Project defaults: 48 CSS-pixel touch regions, 16px input/body text, 16px phone gutters, safe areas owned by the native container and web bottom navigation; these are implementation choices, not claims that CSS pixels equal Android dp. Test narrow 320/390px, larger phone, short landscape, tablet and desktop, large text, keyboard/focus, empty/locked/offline/error states, native exports and Back. Physical-device and release evidence must be reported separately.

Public native iPhone distribution is excluded by the user’s Android-only scope and no-payment constraint. Android distribution uses the signed website APK, without an app-store enrollment. The final production publication and verification evidence are recorded in RELEASE-RESULTS.md.
