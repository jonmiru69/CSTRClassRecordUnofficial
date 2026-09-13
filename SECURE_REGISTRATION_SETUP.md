# Activate the registration code gate (free Spark plan — no billing)

Status: implemented and passing local tests. Not yet applied to the live
Firebase project. No project billing, secret, accounts, or live database
rules were changed by preparing this package.

Project: `cstr-class-record-global`.

## Why this version doesn't need Cloud Functions or Blaze

A public website genuinely cannot keep a secret in its own JavaScript — a
Cloud Function that checks the code on a private server is the textbook way
to fix that, but on Firebase that requires the Blaze (pay-as-you-go) plan.

This version gets the same real guarantee — the code is checked somewhere a
browser can't read or edit — using only the Realtime Database's built-in
**Security Rules**, which are already part of the free Spark plan you're on.
Rules run on Firebase's servers, not in the browser, so they can do exactly
what a Cloud Function would have done here: compare a submitted code against
a private value the client is never allowed to read, and only let a write
through if it matches.

**What this buys you:** creating a *working* account — one that can read or
write a single byte of your class-record data — is impossible without the
correct code, whether someone uses this website, edits the JavaScript in
DevTools, or calls the Firebase APIs directly. That's enforced by the
database rules, which nothing in the browser can override.

**What it can't do, and the paid version could:** it can't stop the raw
*creation* of a Firebase Auth account itself (Google or email/password) —
blocking that specific action requires a Blaze-only "before create" hook.
In practice this doesn't matter: an account created that way is completely
inert. It has no profile, no data, and every single rule in
`firebase-database-rules.json` requires `cstr-registration-approved/{uid}`
to exist before that uid can read or write anything — and that node can
only ever be created by successfully spending a code-verified ticket. An
account without one can sign in and see... nothing. No software can
honestly promise zero bugs or protection from every possible attack, but
this closes the actual gap you asked about — the Google Sign-In popup
handing out working accounts with no code — at zero cost.

## How it works

1. The person enters the admin code + their intended email. The app tries
   to create a short-lived, single-use "ticket" in the database. The rules
   only allow that write if the code matches the private value stored at
   `cstr-registration-secret/code` — a node the app can never read back, only
   compare against. A wrong code means the write is rejected and nothing is
   created; a right code means the ticket now exists.
2. Only once that ticket exists does the app let "Continue with Google" or
   account creation proceed (unchanged from before — see `ASSETS/app.js`).
3. After sign-in, the app spends that ticket (rules make this single-use and
   time-limited to 10 minutes) and, in the same step, records the new
   account as approved. From then on, every class-record rule checks that
   approval record.
4. Already-approved returning teachers using "Sign in with Google" again
   still see the code prompt on a fresh popup (this matches the app's
   existing behavior, unchanged) — but re-authorizing is a harmless no-op
   for them; it does not re-spend a ticket or touch their existing data.
   Ordinary email/password sign-in never asks for the code at all.

## Administrator activation order

1. Back up the Realtime Database and the current deployed website/rules.
2. Open **Firebase Console → Build → Realtime Database → Data**.
3. Create the node `cstr-registration-secret` with a single child `code`,
   and set its value to a new, long, random string (16+ characters — e.g.
   generate one with a password manager). This is a plain data write in the
   console UI: no CLI, no Cloud Functions, no billing plan change. Do not
   reuse any code that was ever used in the earlier client-side-only
   version, and don't paste it into source files, commits, or chat.
4. Open the **Rules** tab of Realtime Database and replace the contents with
   `firebase-database-rules.json` from this package (or run
   `firebase deploy --only database`, which is free on Spark). Click
   **Publish**.
5. Migrate already-approved existing teachers: for each account that should
   keep working, open **Authentication** to find their UID, then under
   **Realtime Database → Data**, add a node at
   `cstr-registration-approved/<their UID>` with any object value, e.g.
   `{ "approvedAt": 0, "migrated": true }` — the rules only require that a
   node with the required fields is missing for the *first-ever* write to
   succeed via the app; an admin writing it directly from the console is a
   separate, always-allowed action console access. Do this individually —
   don't approve every account in your Auth list without checking it.
6. Publish the revised `index.html` and `ASSETS/` folder to GitHub Pages.
   Keep every existing production record intact. No secret should be
   committed to the repository.

## Required live acceptance tests

Use disposable test emails and a test class, not real learner records.

- Wrong code: no ticket is created; the code-entry form shows an error and
  the Google popup / account creation never opens.
- Correct code: "Continue with Google" becomes available; signing in with a
  *different* email than the one entered is rejected before any database
  write happens (this part is still a client-side check, purely for a clear
  error message — the code itself was already verified server-side).
- Correct code + matching email: Google registration and profile setup
  succeed, and the resulting account can read/write its own class data.
- Reusing the same ticket a second time (e.g. refresh and retry) fails.
- Waiting past 10 minutes before finishing sign-in fails, with a clear
  "verify the admin code again" message.
- A pre-existing account that was never approved (e.g. created by calling
  the Firebase Auth REST API directly, bypassing the website) can sign in
  but cannot read or write any class-record data — try this from the
  Realtime Database Rules Playground in the console (free, no code needed)
  to confirm without touching real data.
- Reviewed existing teachers retain their records after the migration step
  above. New teachers can save/reopen records, reset passwords, and use
  Google login and legacy linking as before.

Don't describe registration as live-protected until these checks pass on
the actual Firebase project. The Rules Playground (Realtime Database →
Rules → Playground) is the fastest free way to run through the ticket/code
logic itself without needing a second Google account.

## Honest limits of this design (free plan trade-offs)

- **No IP-based rate limiting.** The paid version limited wrong-code guesses
  per IP address; that required a server to see request IPs. There's no
  equivalent here. In practice this is a minor risk for a small class-record
  app used by a handful of teachers, but it's worth knowing about. If you
  ever want it back, it would require Cloud Functions (Blaze).
- **Raw account creation isn't blocked**, only made useless — see "What it
  can't do" above.
- **Rotating the code** is a single data edit: change the value at
  `cstr-registration-secret/code` in the console. Any ticket already issued
  under the old code keeps working until it's used or expires (max 10
  minutes), same as before; there's no need to redeploy anything.
- **Revoking an approved account** (e.g. someone who shouldn't have access
  anymore) means deleting their node under `cstr-registration-approved` in
  the console — the rules make that node create-once from the app side, so
  only an administrator via the console can remove it.

Official references:

- [Realtime Database Security Rules](https://firebase.google.com/docs/database/security)
- [Rules language reference (`now`, `root`, `auth`, string/type methods)](https://firebase.google.com/docs/database/security/rules-conditions)
- [Test rules with the Rules Playground / Emulator Suite](https://firebase.google.com/docs/rules/simulator)
