# ASSETS/vendor/firebase-compat.bundle.js

This is the official **Firebase JS SDK v10.14.1** (Apache License 2.0),
containing exactly the three "compat" modules this app uses — `app`,
`auth`, and `database` — bundled into one file and self-hosted here
instead of being loaded from `https://www.gstatic.com/firebasejs/...`.

**Why:** loading Firebase from an external CDN meant login/sign-up/claim
would fail with "Firebase SDK not loaded" any time that separate
`gstatic.com` connection was slow, filtered by a school/network firewall,
or blocked by a browser extension — even though the rest of the site
(hosted on GitHub Pages) loaded fine. Self-hosting removes that second
point of failure: the SDK now comes from the same origin as everything
else.

It attaches `window.firebase` exactly like the old CDN scripts did, so
`ASSETS/firebase-sync.js` needs no changes to use it.

## Rebuilding it (e.g. to bump the Firebase version)

```bash
npm install firebase@<version> esbuild --no-save
```

Create an entry file `firebase-compat-entry.js`:

```js
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/database";

if (typeof window !== "undefined") {
  window.firebase = firebase;
} else if (typeof self !== "undefined") {
  self.firebase = firebase;
}
```

Then bundle it:

```bash
npx esbuild firebase-compat-entry.js \
  --bundle \
  --format=iife \
  --platform=browser \
  --target=es2018 \
  --minify \
  --define:process.env.NODE_ENV=\"production\" \
  --outfile=firebase-compat.bundle.js
```

Replace this file with the output, and bump the `?v=` query string on
the `<script>` tags in `index.html` so browsers/GitHub Pages don't serve
a cached copy.
