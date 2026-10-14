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
      async signUpWithEmail() { throw new Error("Firebase SDK not loaded"); },
      async signInWithEmail() { throw new Error("Firebase SDK not loaded"); },
      async sendPasswordResetEmail() { throw new Error("Firebase SDK not loaded"); },
      async changePassword() { throw new Error("Firebase SDK not loaded"); },
      async setInitialPassword() { throw new Error("Firebase SDK not loaded"); },
      async unlinkPasswordProvider() { throw new Error("Firebase SDK not loaded"); },
      hasPasswordProvider() { return false; },
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
  const authPersistence = auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

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
      await authPersistence;
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await auth.signInWithPopup(provider);
      try { await window.CSTRRegistration.enroll(result.user); }
      catch (error) { await auth.signOut(); throw error; }
      return result.user;
    },

    // Creates a pending identity. Developer approval is required for database access.
    async signUpWithEmail(email, password) {
      await authPersistence;
      return window.CSTRRegistration.createEmail(String(email || "").trim(), password);
    },

    // Typical email + password sign-in — no popup, no redirect.
    async signInWithEmail(email, password) {
      await authPersistence;
      const result = await auth.signInWithEmailAndPassword(String(email || "").trim(), password);
      if (!await window.CSTRRegistration.isApproved(result.user)) {
        await auth.signOut();
        throw new Error("This account requires administrator approval. Contact the developer before signing in.");
      }
      return result.user;
    },

    // Sends Firebase's built-in password-reset email (a secure one-time link).
    // There is no server in this project to mint or verify a typed-in
    // confirmation code, so a reset link is the correct, zero-backend way to
    // do "forgot password" on a static GitHub Pages site.
    async sendPasswordResetEmail(email) {
      await auth.sendPasswordResetEmail(String(email || "").trim());
    },

    // True if this account can sign in with email + password (as opposed to
    // a Google-only account that has never set a password).
    hasPasswordProvider(user) {
      const target = user || auth.currentUser;
      return Boolean(target && target.providerData.some((p) => p.providerId === "password"));
    },

    // Changes the password for an account that already has one. Firebase
    // requires a recent sign-in for this, so the current password is used to
    // re-authenticate first.
    async changePassword(currentPassword, newPassword) {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error("You need to be signed in with an email address to change your password.");
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPassword);
    },

    // Adds a password sign-in option to an account that currently only has
    // Google Sign-In, so it can also use typical email + password login
    // afterward (no need to re-authenticate with a password here — linking a
    // NEW credential onto an already-signed-in session doesn't require one).
    async setInitialPassword(newPassword) {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error("No signed-in account with an email address was found.");
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, newPassword);
      await user.linkWithCredential(credential);
      return user;
    },

    // Removes the password sign-in method from the current account, leaving
    // any other providers (e.g. Google) untouched. Used to roll back a
    // just-added password credential if a legacy-account bind fails right
    // after it (e.g. the code was mistyped) — so a bad attempt never leaves
    // a stray/incorrect password sitting on someone's account.
    async unlinkPasswordProvider() {
      const user = auth.currentUser;
      if (!user) return;
      await user.unlink("password");
    },

    async signOut() {
      try {
        await auth.signOut();
      } catch (err) {
        console.warn("CSTRSync: signOut error", err);
        throw err;
      }
    },

    // Look up teacher profile mapped to this Google UID
    async getUserProfile(uid) {
      if (!uid) return null;
      const snap = await db.ref(`${USERS_PATH}/${uid}`).once("value");
      return snap.val();
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
    async bindLegacyAccount() {
      throw new Error("Legacy recovery requires verified developer approval. Contact SANCHEZRAMIL2202@GMAIL.COM.");
    },

    // Auto-provision a new teacher profile using their Google account (zero manual code edits needed!)
    async registerNewTeacher(user, teacherName) {
      if (!user || !user.uid) throw new Error("Authenticated Google user required");

      if (!await window.CSTRRegistration.isApproved(user)) throw new Error("Administrator registration approval required.");
      const existing = await this.getUserProfile(user.uid);
      if (existing?.dataKey) return existing;
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
            onData(null, { isOwnEcho: false, savedAt: null, clientId: null, revision: 0 });
            return;
          }
          const { _syncClientId, _syncSavedAt, _syncRevision, _syncProtocol, ...state } = raw;
          onData(state, {
            isOwnEcho: _syncClientId === CLIENT_ID,
            savedAt: _syncSavedAt || null,
            revision: _syncRevision || 0,
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
    async save(userKey, state, expectedRevision) {
      const sanitized = sanitizeKey(userKey);
      if (!sanitized || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid record revision.");
      const ref = db.ref(`${DATA_PATH}/${sanitized}`);
      const result = await ref.transaction(current => {
        const revision = current?._syncRevision || 0;
        if (revision !== expectedRevision) return;
        return { ...state, _syncProtocol: 2, _syncRevision: revision + 1, _syncClientId: CLIENT_ID, _syncSavedAt: firebase.database.ServerValue.TIMESTAMP };
      }, undefined, false);
      if (!result.committed) {
        // A fresh read supplies the actual conflict, including when the transaction's first cache was empty.
        const raw = (await ref.once("value")).val() || {};
        const { _syncRevision, _syncSavedAt, _syncClientId, _syncProtocol, ...remoteState } = raw;
        const error = new Error("The cloud record changed. Review both versions in Settings before saving.");
        Object.assign(error, { code: "sync/conflict", remoteState, revision: _syncRevision || 0, savedAt: _syncSavedAt });
        throw error;
      }
      return result.snapshot.val()._syncRevision;
    }
  };
})();
