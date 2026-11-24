# Fill official gradesheets (website only)

The Overview and each class's Period options have **Fill official gradesheets**. This fills the registrar's existing native Google Sheets, rather than generating another workbook. The school-account connection is separate from class-record sign-in. No password, access token, school-account identifier, student name, or official-file identifier is configured in the repository.

## Teacher workflow

1. Open the Quarterly / Semestral workspace and choose **Fill official gradesheets**. The button waits for any current cloud save and saves pending class-record changes before preparing the transfer. A failed save or unresolved conflict blocks transfer. The app scans active classes and includes only periods that pass its existing completion check. A finished unlocked period is eligible. An unfinished locked period is excluded. Category headings and blank rows are not learners. Classes with no completed periods do not appear.
2. Enter your own `cstr.edu.ph` email and choose **Connect school account**. Google opens its account chooser and consent screen. Select the school identity that the registrar authorized for the subject cells. This does not switch the account used for the class-record workspace.
3. For each selected class/semester, paste the registrar's Google Sheets file link, check the link, and select the subject tab. A Drive home URL is not a file link. Class links are remembered in this browser under the signed-in workspace user, source class, semester, calendar mode, and school year. Reconnecting checks remembered links automatically. Changing an account or target requires another preview.
4. Verify any explicitly displayed differences in section/subject names. For example, the same section may use different spellings in the class record and registrar's heading. The app never resolves a learner's identity through approximate matching. Correct mismatched or duplicate learner names before transferring.
5. Preview the completed periods. Review learner names, quarters, exact destination cells, weighted WW/PT/QA, and previous values. The UI displays three decimals; the numeric writes retain calculation precision. Existing differing values require explicit approval. **Download change report** saves the previous and proposed input values locally for review or manual restoration.
6. Choose **Fill verified gradesheets**. The site rechecks source completion, target identity, names, formulas, and permissions. Each workbook receives one atomic batch, containing only numeric C–E input updates. It then reads the scores back and checks every selected value and the preserved F–G formulas. No completion, grading, or formula is invented for an unfinished period.

For later corrections, edit the class record (unlock its period first if necessary), then use **Fill official gradesheets** again. The same saved links and valid school connection are reused. A fresh preview compares the latest saved values with the current official cells; changed values can be replaced after review. Already matching learner-period rows make no write. If the edit leaves a required mark blank, that period is excluded until it is complete again. This is a repeatable push from the class record to the official sheet, not background synchronization or importing manual school-sheet edits into the class record.

## Supported template and checks

Supported: the inspected CST-R Form 1 quarterly JHS layout (four quarter rows plus F per learner) and SHS semester layout (two quarter rows plus F), with NAMES / PERIOD or Quarter in A–B, weighted WW/PT/QA in C–E, and existing grade formulas in F–G. The school year, grade level, semester, component headers/weights, and period identities must agree. Header variants inspected include `YEAR & SECTION:` and `Yr.& Sec:`. Trimester, zero-based grading, raw Excel uploads, foreign layouts, sheets larger than 3,000 rows, absent grade formulas, and formulas in C–E are rejected. The feature does not convert the registrar's files or modify their permissions.

All named official learners must match a named source learner in each completed period. Departures, late enrollment, name corrections, or other roster differences need reconciliation before filling. A mismatch blocks that preview instead of silently leaving stale official grades.

Google remains authoritative for protected-cell permissions. The site preflights protected and unprotected ranges using the connected account's `requestingUserCanEdit`; Google's batch also enforces permissions. It does not unlock cells or impersonate another teacher.

Atomicity is per workbook, not across multiple files. If a later workbook fails, earlier verified workbooks stay filled and the UI reports progress. A fresh read reduces stale-write risk, but Google Sheets does not offer a compare-and-swap precondition here: pause edits to these input cells while filling. A lost write response is resolved by reading back, never by automatically repeating the write. If readback is unavailable or differs, stop, inspect the reported workbook, and preview again. Downloaded change reports include grades and must be stored as school records.

## Site administrator setup and live acceptance

The implementation reuses the existing Firebase project's Google OAuth provider through a separate named Firebase app with in-memory persistence. It asks for `https://www.googleapis.com/auth/spreadsheets`. The access token is held in page memory, and the app refuses requests after the connection's 50-minute limit. The token is cleared on the next attempted request after that limit, disconnect, workspace-account change/logout, or leaving the page. The secondary Firebase sign-in signs out immediately after obtaining the Google credential. It does not read or write the school identity's class-record database. It may create a Firebase Authentication user for the connected school identity; it does not approve that identity as a class-record teacher.

Before a production release:

1. In the existing Firebase project's Google Cloud console, verify that **Google Sheets API** is enabled. No new client secret or service account belongs in the website.
2. Check the existing Google OAuth consent configuration for the Sheets scope, authorized web hosting domain, intended teacher/test users, and any Google verification requirements. The school Workspace administrator may need to allow the OAuth app. Do not weaken school protections or bypass an access denial.
3. Deploy to an authorized preview origin, then have the teacher complete the real school-account consent flow. First use a school-approved disposable copy of each template variant to verify both writable subject cells and denied cells. Compare all transferred WW/PT/QA and resulting grade formulas, including actual zero, and verify that unfinished periods and other subject tabs remain unchanged.
4. Release only after live account/permission acceptance passes. The existing main-branch workflow also publishes an Android release, although these feature scripts/styles are expressly removed from its bundle. Do not merge merely to obtain an OAuth test deployment.

Mocked browser tests are not evidence that the production OAuth app is enabled, verified, or allowed by the school. Real school OAuth and a live write/readback have not been exercised in this change. No official grades were changed while preparing it.

The website does not connect to a teacher's ChatGPT session or require an OpenAI API key. Mapping and transfer use deterministic code; scores go directly from the browser to Google Sheets.

## Verification

- `pnpm test`: existing regressions, 18 mapping/protection tests, and the actual app's completed-period collector.
- `node tests/official-sync-browser.cjs`: simulated Google account isolation, numeric write/readback, untouched names/formulas/other quarters, stale target/source rejection, lost-response recovery, responsive screenshots, and exclusion from the built Android package.
- `pnpm test:visual`: existing visual checks plus the new browser tests. The latter use invented records and intercepted HTTP responses; no live Google traffic.

References: [Firebase Google sign-in and additional scopes](https://firebase.google.com/docs/auth/web/google-signin), [Sheets atomic batch updates](https://developers.google.com/workspace/sheets/api/guides/batchupdate), and [protected ranges and requestingUserCanEdit](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets#ProtectedRange).
