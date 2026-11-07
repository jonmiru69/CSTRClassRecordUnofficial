# Approve CST-R teacher access from a phone

Teachers select **Request a teacher account** and send the prepared email to **sanchezramil2202@gmail.com** from their intended sign-in address. They include their name and faculty role. The message is a request for the developer to verify, never a password, account code, or learner record.

1. Verify the request against school records or through an established school channel. Sign in to Firebase Console on your phone with the authorized developer account.
2. Open [Authentication → Users](https://console.firebase.google.com/project/cstr-class-record-global/authentication/users). Find the exact email. For a new teacher, choose **Add user** with that email and a unique, randomly generated temporary password. Keep the password private. If an unapproved identity already exists, review its linked providers and verify who controls it before using it. If ownership is unclear, resolve it before granting access.
3. Copy the account’s **User UID**. In [Realtime Database → Data](https://console.firebase.google.com/project/cstr-class-record-global/database/cstr-class-record-global-default-rtdb/data), add that UID under `cstr-registration-approved` with the Boolean value `true`. Approve the exact UID, since this is what authorizes a workspace.
4. Tell the teacher to use **Forgot password?** at the website to receive Firebase’s password setup link, then sign in. A teacher with an already linked, verified Google account can use **Continue with Google** and choose **Sign in with approved Google account**. If Google cannot sign in to the approved identity, use email and password. Keep the same UID when resolving sign-in or recovery issues.

To revoke access, delete the entire approval child for that UID. Disable the Firebase Authentication account and revoke sessions if credentials may be compromised. Existing workspace data stays with the same owner mapping.

## Firebase enforcement

The Global project uses `client.permissions.disabledUserSignup=true` in its Firebase Authentication configuration. This project-wide control blocks account creation through client APIs, including Google sign-in for a new identity. Keep this setting enabled alongside the Realtime Database rules in this repository. The rules separately check approval and ownership for each workspace. See the [Identity Platform configuration reference](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config).

See [APPLY-CHANGES.md](APPLY-CHANGES.md) for verified older-record recovery, backups, and deployment.
