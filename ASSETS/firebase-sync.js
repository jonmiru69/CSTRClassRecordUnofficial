(() => {
  "use strict";

  // ============================================================================
  // CSTR Class Record — real-time sync & auth module (Firebase Realtime Database)
  // ============================================================================
  // This module handles live synchronization and Google Authentication with
  // multi-tenant data isolation.
  //
  // Real access control lives in the Realtime Database Rules set in the Firebase
  // console (see firebase-database-rules.json and FIREBASE_SETUP.md).
  // ============================================================================
  const firebaseConfig = {
    apiKey: "AIzaSyBgwxuXawJI_jWrlJ02R9eiPcgNMAN9m_Y",
    authDomain: "cstr-class-record-global.firebaseapp.com",
    databaseURL: "https://cstr-class-record-global-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "cstr-class-record-global",
    storageBucket: "cstr-class-record-global.firebasestorage.app",
    messagingSenderId: "164642028411",
    appId: "1:164642028411:web:10d986ca8c095db57e1bde"
  };

  const DATA_PATH = "cstr-class-record-data";
  const BINDINGS_PATH = "cstr-class-record-bindings";
  const USERS_PATH = "cstr-class-record-users";

  // A random id generated fresh each time this tab loads. It rides along with
  // every save so this same tab can recognize "that update was just an echo
  // of my own save" and not treat its own write as an incoming remote change.
  const CLIENT_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function sanitizeKey(rawKey) {
    // Realtime Database path segments can't contain . # $ [ ] /
    return String(rawKey || "").trim().replace(/[.#$[\]/]/g, "_");
  }

  if (!window.firebase || !window.firebase.initializeApp) {
    console.error("CSTRSync: the Firebase SDK scripts did not load. Check index.html and your network connection.");
    window.CSTRSync = {
      configured: false,
      ready: Promise.reject(new Error("Firebase SDK not loaded")),
      subscribe() { return () => {}; },
      async save() { throw new Error("Firebase SDK not loaded"); },
      async signInWithGoogle() { throw new Error("Firebase SDK not loaded"); },
      async signOut() {},
      getCurrentUser() { return null; }
    };
    return;
  }

  const isConfigured = Boolean(firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_"));

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.database();

  function ensureReady() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      });
    });
  }

  window.CSTRSync = {
    configured: isConfigured,
    clientId: CLIENT_ID,
    auth,
    db,

    // Resolves once this tab has an active authenticated user.
    get ready() {
      return ensureReady();
    },

    getCurrentUser() {
      return auth.currentUser;
    },

    onAuthStateChanged(callback) {
      return auth.onAuthStateChanged(callback);
    },

    // Signs in with Google using OAuth popup
    async signInWithGoogle() {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await auth.signInWithPopup(provider);
      return result.user;
    },

    async signOut() {
      try {
        await auth.signOut();
      } catch (err) {
        console.warn("CSTRSync: signOut error", err);
      }
    },

    // Look up teacher profile mapped to this Google UID
    async getUserProfile(uid) {
      if (!uid) return null;
      try {
        const snap = await db.ref(`${USERS_PATH}/${uid}`).once("value");
        return snap.val();
      } catch (err) {
        console.warn("CSTRSync: getUserProfile failed", err);
        return null;
      }
    },

    // Check if a legacy account is already bound to a Google Account
    async getLegacyBinding(legacyKey) {
      const sanitized = sanitizeKey(legacyKey);
      if (!sanitized) return null;
      try {
        const snap = await db.ref(`${BINDINGS_PATH}/${sanitized}`).once("value");
        return snap.val();
      } catch (err) {
        console.warn("CSTRSync: getLegacyBinding failed", err);
        return null;
      }
    },

    // Bind a legacy account identifier (e.g. legacyAccountCode) to an authenticated Google User
    async bindLegacyAccount(legacyKey, user) {
      const sanitized = sanitizeKey(legacyKey);
      if (!sanitized) throw new Error("Invalid account identifier");
      if (!user || !user.uid) throw new Error("Authenticated Google user required");

      const existingBinding = await this.getLegacyBinding(sanitized);
      if (existingBinding && existingBinding.boundUid && existingBinding.boundUid !== user.uid) {
        throw new Error("This account is already bound to another Google Account.");
      }

      const now = Date.now();
      const bindingPayload = {
        boundUid: user.uid,
        boundEmail: user.email || "",
        boundName: user.displayName || "",
        boundAt: now
      };

      const userProfilePayload = {
        dataKey: sanitized,
        email: user.email || "",
        name: user.displayName || "",
        boundAt: now,
        isLegacy: true
      };

      // Atomically write the binding and user profile
      const updates = {};
      updates[`${BINDINGS_PATH}/${sanitized}`] = bindingPayload;
      updates[`${USERS_PATH}/${user.uid}`] = userProfilePayload;

      await db.ref().update(updates);
      return userProfilePayload;
    },

    // Auto-provision a new teacher profile using their Google account (zero manual code edits needed!)
    async registerNewTeacher(user, teacherName) {
      if (!user || !user.uid) throw new Error("Authenticated Google user required");

      const now = Date.now();
      const userProfilePayload = {
        dataKey: user.uid,
        email: user.email || "",
        name: (teacherName || user.displayName || "Teacher").trim(),
        createdAt: now,
        isLegacy: false
      };

      await db.ref(`${USERS_PATH}/${user.uid}`).set(userProfilePayload);
      return userProfilePayload;
    },

    // Subscribes to real-time updates for an account's data (keyed by userKey, which is
    // either the bound legacy key or the Google uid for new teachers).
    subscribe(userKey, onData, onError) {
      const sanitized = sanitizeKey(userKey);
      const ref = db.ref(`${DATA_PATH}/${sanitized}`);
      const listener = ref.on(
        "value",
        (snapshot) => {
          const raw = snapshot.val();
          if (!raw) {
            onData(null, { isOwnEcho: false, savedAt: null, clientId: null });
            return;
          }
          const { _syncClientId, _syncSavedAt, ...state } = raw;
          onData(state, {
            isOwnEcho: _syncClientId === CLIENT_ID,
            savedAt: _syncSavedAt || null,
            clientId: _syncClientId || null
          });
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
      const sanitized = sanitizeKey(userKey);
      const payload = { ...state, _syncClientId: CLIENT_ID, _syncSavedAt: Date.now() };
      await db.ref(`${DATA_PATH}/${sanitized}`).set(payload);
    }
  };
})();