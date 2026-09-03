(() => {
  "use strict";

  // ============================================================================
  // CSTR Class Record — real-time sync module (Firebase Realtime Database)
  // ============================================================================
  // This replaces the old GitHub Gist + Personal Access Token flow. Instead of
  // every device needing its own Gist ID and PAT typed into Settings, this file
  // holds ONE shared project config that ships with the app, and every device
  // that loads the site connects to the same live database automatically.
  //
  // IMPORTANT — this config is NOT a secret. Firebase's client config (apiKey,
  // databaseURL, etc.) is meant to be public and shipped in client-side code —
  // it identifies WHICH project to talk to, not WHO is allowed to read/write.
  // Access is controlled entirely by the Realtime Database "Rules" you set in
  // the Firebase console (see FIREBASE_SETUP.md), the same way the old app's
  // password gate controlled the UI but was never "real security" either.
  //
  // Fill in the six values below from your own Firebase project — steps are in
  // FIREBASE_SETUP.md in the root of this repo.
  // ============================================================================
  const firebaseConfig = {
    apiKey: "PASTE_YOUR_API_KEY_HERE",
    authDomain: "PASTE_YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://PASTE_YOUR_PROJECT_ID-default-rtdb.PASTE_YOUR_REGION.firebasedatabase.app",
    projectId: "PASTE_YOUR_PROJECT_ID",
    storageBucket: "PASTE_YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "PASTE_YOUR_SENDER_ID",
    appId: "PASTE_YOUR_APP_ID"
  };

  // Everything lives under this one top-level key in the database, same idea
  // as the single "cstr-class-record-data.json" file the old Gist held.
  const DATA_PATH = "cstr-class-record-data";

  // A random id generated fresh each time this tab loads. It rides along with
  // every save so this same tab can recognize "that update was just an echo
  // of my own save" and not treat its own write as an incoming remote change.
  const CLIENT_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function sanitizeKey(rawKey) {
    // Realtime Database path segments can't contain . # $ [ ] /
    return String(rawKey).replace(/[.#$[\]/]/g, "_");
  }

  if (!window.firebase || !window.firebase.initializeApp) {
    console.error("CSTRSync: the Firebase SDK scripts did not load. Check index.html and your network connection.");
    window.CSTRSync = {
      configured: false,
      ready: Promise.reject(new Error("Firebase SDK not loaded")),
      subscribe() { return () => {}; },
      async save() { throw new Error("Firebase SDK not loaded"); }
    };
    return;
  }

  const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_");

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.database();

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  if (isConfigured) {
    auth.onAuthStateChanged((user) => { if (user) resolveReady(user); });
    auth.signInAnonymously().catch((error) => {
      console.error("CSTRSync: anonymous sign-in failed —", error.message);
      rejectReady(error);
    });
  } else {
    rejectReady(new Error("Firebase config not filled in yet — see FIREBASE_SETUP.md"));
  }

  window.CSTRSync = {
    configured: isConfigured,
    clientId: CLIENT_ID,
    // Resolves once this tab is authenticated and allowed to read/write.
    // Every save/subscribe call should happen after this resolves.
    ready,

    // Subscribes to real-time updates for one account's data (keyed by the
    // same login password the old app used as the per-account key). Fires
    // immediately with whatever is currently stored, then fires again every
    // single time ANY device saves a change to this same account — that is
    // what makes another browser/device show the update live, with nothing
    // to type in on that device.
    //
    // onData receives: (value, meta) where meta.isOwnEcho is true when this
    // update is just this same tab's own save reflecting back, and
    // meta.savedAt / meta.clientId describe who actually wrote it.
    subscribe(userKey, onData, onError) {
      const ref = db.ref(`${DATA_PATH}/${sanitizeKey(userKey)}`);
      const listener = ref.on(
        "value",
        (snapshot) => {
          const raw = snapshot.val();
          if (!raw) { onData(null, { isOwnEcho: false, savedAt: null, clientId: null }); return; }
          const { _syncClientId, _syncSavedAt, ...state } = raw;
          onData(state, { isOwnEcho: _syncClientId === CLIENT_ID, savedAt: _syncSavedAt || null, clientId: _syncClientId || null });
        },
        (error) => {
          console.error("CSTRSync: read failed —", error.message);
          if (onError) onError(error);
        }
      );
      return () => ref.off("value", listener);
    },

    // Writes one account's full state. Every other tab/device subscribed to
    // this same account sees it within a second or two, automatically.
    async save(userKey, state) {
      const payload = { ...state, _syncClientId: CLIENT_ID, _syncSavedAt: Date.now() };
      await db.ref(`${DATA_PATH}/${sanitizeKey(userKey)}`).set(payload);
    }
  };
})();
