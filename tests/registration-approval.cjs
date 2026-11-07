'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const user = { uid: 'teacher', email: 'teacher@example.test' };
  let approval = false;
  let lookupError;
  let signOuts = 0;
  const signIn = async () => {
    auth.currentUser = user;
    return { user };
  };
  const auth = {
    currentUser: null,
    setPersistence: async () => {},
    signInWithPopup: signIn,
    signInWithEmailAndPassword: signIn,
    signOut: async () => { signOuts++; auth.currentUser = null; }
  };
  const firebase = {
    apps: [{}],
    initializeApp() {},
    auth: Object.assign(() => auth, {
      Auth: { Persistence: { SESSION: 'session' } },
      GoogleAuthProvider: class { setCustomParameters() {} }
    }),
    database: () => ({
      ref(key) {
        assert.equal(key, 'cstr-registration-approved/teacher');
        return { once: async () => {
          if (lookupError) throw lookupError;
          return { exists: () => approval };
        } };
      }
    })
  };
  const context = vm.createContext({ window: { firebase }, firebase, console });
  for (const file of ['registration.js', 'firebase-sync.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ASSETS', file), 'utf8'), context);
  }
  const { CSTRSync: sync, CSTRRegistration: registration } = context.window;
  assert.equal(registration.email, 'sanchezramil2202@gmail.com');
  assert.equal(sync.signUpWithEmail, undefined);
  assert.equal(registration.createEmail, undefined);

  for (const attempt of [() => sync.signInWithEmail(user.email, 'test-password'), () => sync.signInWithGoogle()]) {
    approval = false;
    await assert.rejects(attempt, { code: 'cstr/approval-required' });
    assert.equal(auth.currentUser, null);

    approval = true;
    lookupError = new Error('Synthetic database failure');
    await assert.rejects(attempt, lookupError);
    assert.equal(auth.currentUser, null);

    lookupError = undefined;
    assert.equal(await attempt(), user);
    assert.equal(auth.currentUser, user);
  }
  approval = false;
  await assert.rejects(sync.registerNewTeacher(user, 'Teacher'), { code: 'cstr/approval-required' });
  assert.equal(auth.currentUser, null);
  assert.equal(signOuts, 5);
  console.log('PASS: Both sign-in providers and workspace setup require developer approval and fail closed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
