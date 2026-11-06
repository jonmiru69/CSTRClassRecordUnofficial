(() => {
  "use strict";
  const pending = "Account approval required. Email SANCHEZRAMIL2202@GMAIL.COM from your sign-in address. Never send passwords or student records.";
  function approvalIsActive(value) {
    return value === true || Boolean(value && typeof value === 'object' &&
      typeof value.approvedAt === 'number' && value.approvedAt > 0 &&
      typeof value.approvedBy === 'string' && value.approvedBy.length > 0 &&
      value.active !== false && value.revoked !== true);
  }
  async function isApproved(user) {
    if (!user) return false;
    const approval = await firebase.database().ref("cstr-registration-approved/" + user.uid).once("value");
    // The initial Hosting release keeps the faculty approval check aligned with deployed v4 rules.
    // The pilot and emulator use the stricter check after approval-shape compatibility is verified.
    const useDeployedRules = window.document?.querySelector('meta[name=cstr-legacy-approval]')?.content === 'deployed-rules';
    return useDeployedRules ? approval.exists() : approvalIsActive(approval.val());
  }
  window.CSTRRegistration = {
    authorized: () => true, requireGrant() {}, clear() {}, isApproved, approvalIsActive,
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
