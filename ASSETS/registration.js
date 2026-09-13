/* ============================================================================
 * CSTR Class Record — registration code gate (Firebase Spark/free plan)
 * ============================================================================
 * No Cloud Functions, no Blaze billing, no Identity Platform. The admin code
 * is verified by the Realtime Database's own security rules at write time —
 * that check runs on Firebase's servers, not in this file — so the code
 * itself is never sent back to the browser and can't be read out of the
 * page source or overridden by editing this script.
 *
 * How it works:
 *   1. authorize(code, email) tries to create a random, short-lived "ticket"
 *      node in the database. The database rules only allow that write to
 *      succeed if the submitted code matches the private code stored at
 *      cstr-registration-secret/code (a node this script can never read —
 *      only the rules engine can compare against it). A rejected write means
 *      a wrong code; a successful write means the code was correct.
 *   2. Only once that ticket exists does the app enable "Continue with
 *      Google" / account creation (see ASSETS/app.js).
 *   3. After the person authenticates, enroll()/createEmail() spend that
 *      ticket (single-use, rules-enforced) and record the resulting account
 *      as approved at cstr-registration-approved/{uid}. Every class-record
 *      read/write rule requires that node to exist — so even an account
 *      created outside this website entirely (e.g. by calling Firebase's
 *      sign-up API directly, which this free plan cannot block the way a
 *      paid blocking Cloud Function could) still has zero access to any
 *      class data until it goes through this same code-gated flow.
 *
 * See SECURE_REGISTRATION_SETUP.md for the one-time admin setup and an
 * honest rundown of what this design does and doesn't protect against.
 * ============================================================================ */
(() => {
  "use strict";

  const TICKETS_PATH = "cstr-registration-tickets";
  const APPROVED_PATH = "cstr-registration-approved";
  const TICKET_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes

  const sync = window.CSTRSync;
  if (!sync || !sync.db || !sync.auth) {
    console.error("CSTRRegistration: CSTRSync (ASSETS/firebase-sync.js) did not initialize. Check script order in index.html and your network connection.");
    const unavailable = () => { throw new Error("The registration service is unavailable. Reload the page and try again."); };
    window.CSTRRegistration = {
      authorized: () => false,
      async isApproved() { return false; },
      requireGrant: unavailable,
      clear() {},
      authorize: unavailable,
      enroll: unavailable,
      createEmail: unavailable
    };
    return;
  }

  const db = sync.db;
  let grant = null; // { ticketId, email, expiresAt } — in-memory only, never persisted.

  function ticketRef(ticketId) { return db.ref(`${TICKETS_PATH}/${ticketId}`); }
  function approvedRef(uid) { return db.ref(`${APPROVED_PATH}/${uid}`); }

  function newTicketId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function authorized() {
    return !!grant && grant.expiresAt > Date.now();
  }

  function requireGrant(email) {
    if (!authorized()) throw new Error("Registration authorization expired. Verify the admin code again.");
    if (email && grant.email !== String(email).trim().toLowerCase()) {
      throw new Error("Use the same email address you entered with the registration code.");
    }
    return grant;
  }

  // Never trust a client-side flag for this. The only true answer lives in
  // the database at cstr-registration-approved/{uid}, which is exactly what
  // every class-record security rule checks too.
  async function isApproved(user) {
    if (!user || !user.uid) return false;
    try {
      const snap = await approvedRef(user.uid).once("value");
      return snap.exists();
    } catch (err) {
      // A denied/failed read is never treated as approval.
      return false;
    }
  }

  async function authorize(code, email) {
    grant = null;
    const trimmedCode = typeof code === "string" ? code.trim() : "";
    const trimmedEmail = String(email || "").trim().toLowerCase();
    if (!trimmedCode) throw new Error("Enter the administrator registration code.");
    if (!trimmedEmail || !trimmedEmail.includes("@")) throw new Error("Enter a valid account email.");

    const ticketId = newTicketId();
    const expiresAt = Date.now() + TICKET_LIFETIME_MS;
    try {
      // This write only succeeds if trimmedCode matches the private secret —
      // enforced by firebase-database-rules.json, not by this script.
      await ticketRef(ticketId).set({ code: trimmedCode, used: false, expiresAt });
    } catch (err) {
      throw new Error("Invalid registration secret code. Contact the administrator for authorization.");
    }
    grant = { ticketId, email: trimmedEmail, expiresAt };
  }

  // Spends the current ticket and marks `user` as approved. Used right after
  // a Google popup sign-in. Safe to call again for an already-approved
  // returning teacher — it's a no-op in that case, no fresh code needed.
  async function enroll(user) {
    if (await isApproved(user)) return;
    const ticket = requireGrant(user.email);
    try {
      await ticketRef(ticket.ticketId).update({ used: true, usedByUid: user.uid });
    } catch (err) {
      throw new Error("Registration authorization expired, was already used, or does not match. Verify the admin code again.");
    }
    try {
      await approvedRef(user.uid).set({ ticketId: ticket.ticketId, approvedAt: firebase.database.ServerValue.TIMESTAMP });
    } catch (err) {
      throw new Error("Account approval could not be recorded. Try again or contact the administrator.");
    }
    if (!await isApproved(user)) throw new Error("Account approval was not confirmed.");
  }

  // Creates a brand-new email/password account directly with the client SDK
  // (no Admin SDK / custom token needed) and spends the current ticket to
  // approve it. Rolls back the orphaned account if approval fails, so the
  // same email can be retried instead of hitting "already in use".
  async function createEmail(email, password) {
    const trimmedEmail = String(email || "").trim().toLowerCase();
    const ticket = requireGrant(trimmedEmail);
    const credential = await sync.auth.createUserWithEmailAndPassword(trimmedEmail, password);
    const user = credential.user;
    try {
      await ticketRef(ticket.ticketId).update({ used: true, usedByUid: user.uid });
      await approvedRef(user.uid).set({ ticketId: ticket.ticketId, approvedAt: firebase.database.ServerValue.TIMESTAMP });
      if (!await isApproved(user)) throw new Error("not confirmed");
    } catch (err) {
      try { await user.delete(); } catch (_) { /* best effort */ }
      try { await sync.auth.signOut(); } catch (_) { /* best effort */ }
      throw new Error("Registration authorization expired, was already used, or does not match. Verify the admin code again.");
    }
    return user;
  }

  window.CSTRRegistration = {
    authorized,
    isApproved,
    requireGrant,
    clear() { grant = null; },
    authorize,
    enroll,
    createEmail
  };
})();
