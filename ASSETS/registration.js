(() => {
  "use strict";
  const email = "sanchezramil2202@gmail.com";
  async function isApproved(user) {
    if (!user) return false;
    return (await firebase.database().ref("cstr-registration-approved/" + user.uid).once("value")).exists();
  }
  function approvalRequired() {
    const error = new Error("Developer approval is required to use the CST-R Class Record.");
    error.code = "cstr/approval-required";
    return error;
  }
  window.CSTRRegistration = { email, isApproved, approvalRequired };
})();
