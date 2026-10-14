(() => {
  "use strict";
  const pending = "Account approval required. Email SANCHEZRAMIL2202@GMAIL.COM from your sign-in address. Never send passwords or student records.";
  async function isApproved(user) {
    if (!user) return false;
    return (await firebase.database().ref("cstr-registration-approved/" + user.uid).once("value")).exists();
  }
  window.CSTRRegistration = {
    authorized: () => true, requireGrant() {}, clear() {}, isApproved,
    async authorize() { throw new Error(pending); },
    async enroll(user) { if (!await isApproved(user)) throw new Error(pending); },
    async createEmail(email, password) {
      if (password.length < 12) throw new Error("Use a passphrase of at least 12 characters.");
      const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
      await firebase.auth().signOut();
      return result.user;
    }
  };
})();
