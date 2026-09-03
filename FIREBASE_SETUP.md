# Setting up live sync (Firebase Realtime Database)

This app needs ONE free Firebase project. Every device that opens the site
then talks to that same project automatically — nothing to type in on any
device, ever. This is a one-time setup done by you (the owner), not something
each teacher/device repeats.

Total time: about 10 minutes. No credit card required.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with any Google account.
2. Click **Add project**. Name it anything, e.g. `cstr-class-record`.
3. When asked about Google Analytics, you can turn it **off** — not needed here.
4. Click **Create project** and wait for it to finish. This project is on the
   free **Spark** plan by default. You never need to upgrade it for this app.

## 2. Turn on the Realtime Database

1. In the left sidebar, open **Build → Realtime Database**.
2. Click **Create Database**.
3. Pick a region close to the Philippines (e.g. `asia-southeast1 (Singapore)`
   if offered — the exact one matters far less than you'd think, since this
   app's traffic is tiny).
4. Choose **Start in locked mode** (we'll paste in the real rules in step 4).

## 3. Turn on Anonymous sign-in

This is what replaces the Personal Access Token — every browser that opens
the site quietly signs itself in, with no password or prompt the teacher ever
sees.

1. Left sidebar → **Build → Authentication** → **Get started**.
2. Under the **Sign-in method** tab, click **Anonymous**, toggle it **Enable**, **Save**.

## 4. Paste in the security rules

1. Back in **Realtime Database**, open the **Rules** tab.
2. Replace whatever is there with the contents of `firebase-database-rules.json`
   from this repo.
3. Click **Publish**.

This says: only a browser that has silently signed in anonymously (i.e. is
actually running this app) may read or write — a random `curl` request from
the open internet with no auth token is refused. It is **not** a substitute
for real accounts and passwords; see the "How protected is this, really?"
section below for the honest picture.

## 5. Get your web app config

1. Click the gear icon next to **Project Overview** → **Project settings**.
2. Scroll to **Your apps**, click the **`</>`** (web) icon.
3. Give it a nickname (e.g. `cstr-class-record-web`), skip Firebase Hosting
   (you're using GitHub Pages), click **Register app**.
4. You'll see a `firebaseConfig` object with six values: `apiKey`,
   `authDomain`, `databaseURL`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`. Copy the whole block.

## 6. Paste the config into the app

Open `ASSETS/firebase-sync.js` in this repo and replace the placeholder
`firebaseConfig` object near the top with the one you just copied. Save,
commit, push.

> This file is safe to commit and safe to be public. A Firebase web config is
> not a secret — it just says *which* project to talk to. Real access control
> lives in the Rules you pasted in step 4, not in hiding this file.

## 7. Deploy

Same as before — this is still a static site with no build step:

1. Push this repo's contents to a new GitHub repository (root of the repo).
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` → `/ (root)`**.
3. GitHub gives you a public URL. That's it — every device that opens it is
   now live-synced, automatically, forever, for free.

## 8. One-time: bring over your existing data (optional)

If you already have class records saved in the old GitHub Gist:

1. Open your Gist's raw `cstr-class-record-data.json` and copy its contents.
   It should already look like `{ "harty342002": { ...your data... }, "maamsamcstr1234": { ... } }`.
   - If instead it's a *flat* object (no account names as keys, just
     `{"version": ..., "registry": [...], ...}` directly), wrap it as
     `{ "harty342002": { ...paste the flat object here... } }` — that flat
     shape was always Sir Harty's account specifically.
2. In the Firebase console, **Realtime Database → the ⋮ menu → Import JSON**.
3. Import it at the `cstr-class-record-data` node (create that top-level key
   if the importer asks where to put it).
4. Log into the site with each account once to confirm its data shows up.

## How protected is this, really?

Being direct about this, since it involves student grades:

- **The old app's password gate was already "not real security"** — its own
  README said so. Anyone who opened the page source could read the four
  valid passwords straight out of `app.js`.
- **The old PAT, however, WAS a real secret.** Even someone who read the
  passwords in the source couldn't write to your Gist without also stealing
  your Personal Access Token, which never appeared in any file — only in
  each device's local browser storage.
- **This new version has no equivalent secret.** The anonymous-auth rule
  blocks bots and direct API requests with no token at all, but it does not
  distinguish "the actual four teachers" from "anyone who finds the site URL
  and opens it in a browser" — anyone who can view the page can also sign in
  anonymously and write to it, the same way anyone who can view the page can
  already read the four passwords. In practice this matches the risk you
  already accepted with the login gate; it just now extends to the save path
  too. If that's a bigger tradeoff than you want, two extra options — I can
  build either in a follow-up:
  - **Firebase App Check** (still free) — ties writes to genuine loads of
    your actual deployed site, blocking most scripted/automated abuse.
  - **A per-write password check in Database Rules** — makes casual poking
    around harder, though anyone reading `app.js` can still find the check,
    same limitation as the login gate today.
- **Practically:** this only matters if someone both discovers the exact
  live URL *and* deliberately digs through the source to abuse it — the same
  threshold that already existed for the login page. It is not exposed to
  search engines or "the whole internet" by default the way, say, a public
  API would be.

## Will this ever cost money?

No, not at this app's scale. The free **Spark** plan includes 1 GB stored and
10 GB/month of database traffic — a handful of class records with occasional
photo uploads is a rounding error against that, and Spark has no time limit,
no "pauses after a week of inactivity," and no credit card requirement. If
this app were ever opened by hundreds of simultaneous users constantly, you'd
eventually want to watch usage in the console — not a realistic scenario for
a single school's class records.
