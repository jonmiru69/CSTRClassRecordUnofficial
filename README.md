# CSTR Class Record — Live

## September 26 design and audit revision

The active visual layers are consolidated into `ASSETS/design-system.css`. The
maroon and gold identity now uses shared color, shape, typography, and motion
tokens. Score and HPS fields have room for `100.00` at desktop and mobile
widths; controls use small corners instead of pill geometry. A labeled light /
dark control follows the device preference until a teacher chooses a theme,
then remembers that choice. Reduced-motion preferences disable transitions.

The audit also corrected a roster bug: a learner name containing "boys" or
"girls" (for example, Boysen) was previously treated as a category divider,
which could clear that learner's scores. Only the explicit `Boys` and `Girls`
divider labels now receive that treatment. The grading engine, Firebase sync,
registration, database rules, and saved-data structure are unchanged.

The supplied ZIP did not include the `cstr-design-system.css` file mentioned in
the audit brief. Its unused `premium.css` referenced Open Sans and Raleway font
files that were also absent. The unused premium CSS, Quicksand files, motion
script, and superseded CSS layers were removed; the site uses system fonts and
one active stylesheet. New classes in this snapshot start with 50 blank rows;
existing 42-row records continue to retain their saved roster length.

**Verified in the supplied snapshot:** local browser previews of sign-in,
overview, records, and both grading modes at desktop and 390px widths; light
and dark mode, persisted theme choice, reduced motion, `100.00` display,
attendance and invalid-score cues, HPS cap and exact restoration, the Boysen
regression, and PDF/Word downloads. The grading engine's worked example still
passes and its source is byte-identical to the archive.

**Not yet verified:** live two-device Firebase propagation and save conflict
resolution with a real account; Excel download, because the existing external
XLSX script did not load in the local test environment; opening the generated
files in Microsoft Office; school-specific grading approval and real teacher
records. The archive has no automated test harness.

## September 19 three-term workspace revision

The header now switches between the existing Quarterly / Semestral records and
an independent, initially empty Trimester (Zero-Based) workspace. The latter
has three terms per class and uses the weighted percentage without the legacy
transmutation table. Existing classes and saved grades stay in the legacy
workspace; no scores are converted. See [REVISION_GUIDE.md](REVISION_GUIDE.md)
for the implemented defaults and checks still needed before production use.

## September 13 workspace and registration revision

This package includes the revised collapsible workspace, compact sheet controls,
automatic per-period completion and reversible HPS adjustments. Read
[REVISION_GUIDE.md](REVISION_GUIDE.md) for behavior and validation details.

**Deployment requirement:** the registration code gate needs a private secret
and updated database rules activated before publishing these frontend files —
100% on the free Firebase Spark plan, no Cloud Functions or billing upgrade
required. Follow [SECURE_REGISTRATION_SETUP.md](SECURE_REGISTRATION_SETUP.md).
Existing approved teachers need to be migrated individually; review accounts
one at a time. This package does not include an admin code or production
credentials.

A client-side class-record web application for Colegio de Sto. Tomas -
Recoletos, Incorporated, San Carlos City, Negros Occidental. It is designed
for the class-record owner(s) named in the app and displays this label
exactly: **Website for Class Record, with respect to DepEd Order No. 15, s.
2026.** The app does not add or interpret details about that order.

This is the **live-sync** version of `cstr-class-record`: same roster,
grading engine, and features, but saved changes now appear on every other
browser/device automatically, in real time, with nothing to type in on any
device. See [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) for the one-time setup
this requires.

## What is included

- Two separately saved class workspaces, with a first-use confirmation before
  entering the empty trimester workspace.
- Three-term class sheets and mode-aware Excel, PDF, and Word exports; the
  quarterly/semestral export layout remains on its original path.

- Secure authentication via **Google Sign-In with 2FA support** (Google Authenticator, prompt, or Gmail verification codes at zero cost).
- Zero plaintext passwords in code or repository files.
- Per-teacher access rules requiring authenticated, administrator-approved accounts.
- Google and email registration require server-verified administrator authorization.
- Safe legacy account linking preserving all existing class records without data loss.
- Seven class records, each with a 42-row blank roster, independent grading
  periods, HPS fields, learner scores, and grade calculations.
- JHS weights of 30 / 40 / 30 and SHS weights of 20 / 50 / 30.
- Written Work (10 slots), Performance Task (8 slots), and Quarterly
  Assessment (ST1, ST2, Term Exam) score sheets.
- Quarterly Assessment intra-weights of 30% / 30% / 40%, normalized when only
  some QA slots are filled.
- Live, cell-by-cell grade computation as scores are typed.
- Score cells accept a raw number or one of four attendance codes — **A**
  (Absent) and **M** (Missing) score as zero against that item's HPS; **E**
  (Excused) and **L** (Late) are excluded entirely, like a blank slot.
- Spreadsheet-style bulk paste from Excel or Google Sheets.
- Drag-select a row, column, or block, then type one value and press Enter
  (or click/tab away) to fill it into every selected cell at once.
- Section tabs color-coded per subject/section, arranged vertically.
- A sticky maroon-and-gold header carrying the CSTR crest.
- A **Save Changes** button that writes the complete state — roster, scores,
  periods, compressed teacher photo — to a shared Firebase Realtime Database,
  and pushes it to every other open device within a second or two.

## What's different from the original version

| | Original (`cstr-class-record`) | This version (`cstr-class-record-live`) |
|---|---|---|
| Storage | One GitHub Gist JSON file | Firebase Realtime Database |
| Cross-device sync | Manual — paste the same Gist ID + Personal Access Token into Settings on every device | Automatic — every device connects to the same project on its own |
| Real-time | No — "Load saved data" had to be clicked manually | Yes — changes saved on one device appear on the others within a second or two |
| Hosting cost | Free (GitHub Pages) | Free (GitHub Pages + Firebase Spark plan) |
| One-time setup | Create a Gist + a token | Create a free Firebase project — see `FIREBASE_SETUP.md` |

The grading engine, roster logic, UI, and every feature above are otherwise
byte-for-byte the same code as the original app.

Security is enforced via **Firebase Authentication** and **Realtime Database Security Rules**. Only authenticated teachers can access their own class records. See [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) for full configuration details and API key domain restrictions.

## Use locally

Open `index.html` in a modern browser, or serve the folder with any basic
static-file server. There is still no build step or framework. Live sync
won't do anything until you complete `FIREBASE_SETUP.md` — until then the app
quietly falls back to saving only on the current device, exactly like the
original app before Gist credentials were entered.

## Publish to GitHub Pages

1. Create a new GitHub repository and copy the contents of this folder to its
   root, preserving the file structure.
2. Complete `FIREBASE_SETUP.md` first (or after — the app works locally
   either way, it just won't sync across devices until it's done).
3. Commit and push to `main`.
4. **Settings → Pages → Build and deployment → Deploy from a branch → `main`
   → `/ (root)`**.
5. GitHub displays the public Pages URL after deployment.

## Grading behavior

Unchanged from the original — `ASSETS/grading-engine.js` is the same
DOM-free, independently testable module. See its file header and the
original app's documented behavior for Written Work / Performance Task /
Quarterly Assessment math, attendance-code handling, and rounding rules.

## Notes on source assumptions

Carried over unchanged from the original app: section tab colors, SHS roster
capacity, the Grade 11 Our Lady of Consolacion class label, and the
photo-resizing behavior. See the original repo's README for the full list.
