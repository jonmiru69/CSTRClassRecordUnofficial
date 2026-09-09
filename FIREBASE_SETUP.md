# Setting Up Live Sync & Authentication (Firebase)

This web application uses **Firebase Realtime Database** with **Firebase Authentication**. Teachers can sign in either with **Google Sign-In** or with a **typical email + password login** (with a working "Change Password" and "Forgot password" flow). Both methods land in the exact same secure, per-teacher database rules — a teacher's UID is a UID either way.

This is a one-time configuration done by the site owner/developer in the Firebase and Google Cloud consoles.

---

## 1. Enable Sign-In Providers (Authentication)

1. Open the [Firebase Console](https://console.firebase.google.com/) and select your project (`cstr-class-record-global`).
2. In the left navigation bar, open **Build → Authentication**.
3. Go to the **Sign-in method** tab.
4. Enable **Google**:
   - Click **Google** (or **Add new provider → Google**).
   - Toggle **Enable** to ON.
   - Under **Project support email**, select your email from the dropdown.
   - Click **Save**.
5. Enable **Email/Password** — **this is the step that turns on the "typical" email + password login, Create Account button, and Forgot Password flow described below:**
   - Click **Email/Password** (or **Add new provider → Email/Password**).
   - Toggle the first switch (**Email/Password**) to ON. You can leave "Email link (passwordless sign-in)" OFF.
   - Click **Save**.
6. If **Anonymous** was previously enabled:
   - Click **Anonymous**, toggle it **Disabled**, and click **Save**. *(This blocks anonymous internet bots from accessing your database).*

Until step 5 is done, the app's email/password Sign In, Create Account, Claim Legacy Account, Change Password, and Forgot Password features will all fail with an `auth/operation-not-allowed` error — the code is ready, but Firebase itself is still rejecting that provider.

---

## 2. Add Authorized Domains

Firebase requires domains to be whitelisted for Google OAuth to function:

1. In **Authentication**, click on the **Settings** tab.
2. Select **Authorized domains** in the submenu.
3. Verify that the following domains are listed (click **Add domain** if missing):
   - `localhost`
   - `jonmiru69.github.io`
4. Click **Save**.

---

## 3. Apply the Zero-Trust Database Security Rules

These rules ensure that:
- Unauthenticated users have **zero access**.
- Each teacher can **only read and write their own class records**.
- Once an existing teacher binds their account, no one else can steal or overwrite it.

1. In the left navigation bar, go to **Build → Realtime Database**.
2. Click the **Rules** tab at the top.
3. Replace the entire contents of the editor with the code from `firebase-database-rules.json`:

```json
{
  "rules": {
    "cstr-class-record-bindings": {
      ".read": "auth != null",
      "$legacyKey": {
        ".write": "auth != null && (!data.exists() || data.child('boundUid').val() === auth.uid)",
        ".validate": "newData.hasChildren(['boundUid', 'boundEmail']) && newData.child('boundUid').val() === auth.uid"
      }
    },
    "cstr-class-record-users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "cstr-class-record-data": {
      "$userKey": {
        ".read": "auth != null && ($userKey === auth.uid || root.child('cstr-class-record-bindings').child($userKey).child('boundUid').val() === auth.uid)",
        ".write": "auth != null && ($userKey === auth.uid || root.child('cstr-class-record-bindings').child($userKey).child('boundUid').val() === auth.uid)"
      }
    },
    "$other": {
      ".read": false,
      ".write": false
    }
  }
}
```
4. Click **Publish**.

---

## 4. Restrict Your Google API Key (Protection against theft)

To ensure that your Firebase API key cannot be abused by external websites:

1. Open the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Ensure project `cstr-class-record-global` is selected at the top.
3. Under **API Keys**, click on the key used for Firebase (typically named `Browser key (auto created by Firebase)`).
4. Under **Set application restrictions**, choose **Websites (HTTP referrers)** and ensure ALL of these are added:
   - `https://jonmiru69.github.io/*`
   - `https://cstr-class-record-global.firebaseapp.com/*`  *(CRITICAL: this is where the Google OAuth popup runs!)*
   - `https://cstr-class-record-global.web.app/*`
   - `http://localhost/*`
5. Under **API restrictions**, choose **"Don't restrict key"** (or if restricted, ensure *Identity Toolkit API*, *Token Service API*, and *Firebase Realtime Database API* are enabled). Setting it to *"Don't restrict key"* is recommended by Google for the Firebase Web Browser Key because your website HTTP Referrer restrictions in Step 4 and the Realtime Database Security Rules in Step 3 already fully protect your database.
6. Click **Save**.
7. **Wait 5 minutes**: Changes in Google Cloud Console take approximately 5–10 minutes to propagate across Google's worldwide servers.

Now, even though the web config is committed to your frontend repository, the key is mathematically restricted to your approved website domains only.

---

## 5. How Existing Teachers Claim & Secure Their Accounts

Teachers who had accounts prior to this security upgrade (`harty342002`, `maamsamcstr1234`, `lycalikezone67`, `shervibels00`) have their data safely preserved in Firebase. **Each legacy code can only ever be claimed once** — it permanently locks to whichever account claims it first, so a second person entering the same code will always see "already bound." That part is intentional (it's what stops the account from being stolen); see Section 8 below for what to do if the *wrong* person claimed one by accident.

To claim and protect their account, a teacher now has two ways in:

**Option A — Email + password (recommended, no Google popup needed):**
1. The teacher visits the deployed website and clicks **"🔐 Have an account from before this upgrade? Claim it here."**
2. They enter their own email address and their legacy account code.
3. Click **"🔐 Claim & Set Up Login."**
4. The app creates them a normal email/password account — **their password is automatically set to their legacy account code** — and binds it to their existing class records. Everything loads immediately, nothing is lost.
5. From then on they sign in with that email + their legacy code as the password, exactly like a typical login. They can change that password anytime from **Settings → Account → Change Password.**

**Option B — Google Sign-In (unchanged from before):**
1. Click **"Sign in with Google"**, then **"Have an existing account created before this upgrade? Click here"** in the onboarding dialog that follows.
2. Enter their previous account code and confirm.
3. Their Google Account is bound the same way it always was.

A teacher isn't limited to one method forever: someone who claimed via Google can open **Settings → Account** and click **Set Password** to add a typical email/password login alongside Google, without losing anything.

---

## 6. How New Teachers Sign Up

Two ways to create a brand-new, empty class record (no legacy code involved) — you, the developer, never need to manually edit `app.js` or push commits to create an account:

**Option A — Create Account button (typical signup):**
1. On the sign-in screen, click **"✨ Create a brand-new account."**
2. Enter full name, email, and a password (6+ characters, entered twice to confirm).
3. Click **"✨ Create My Class Record."** Their personal, isolated workspace is created instantly.

**Option B — Google Sign-In:**
1. Click **"Sign in with Google."** If they're new, the app shows *"Welcome to CSTR Class Record! Set up your account"* — they type their full name and click **"✨ Create Brand-New Class Record."**

---

## 7. Forgot Password / Change Password

- **Forgot password**: on the sign-in screen, "Forgot password?" sends Firebase's built-in password-reset email to the address entered. The teacher clicks the link in that email to set a new password. (This app has no backend server, so a secure emailed link — not a typed-in code — is the correct, standard way to do this without one.)
- **Change password**: signed-in teachers go to **Settings → Account → Change Password**, enter their current password once, and their new password twice.

---

## 8. Fixing a Wrongly-Bound Legacy Account

If a legacy code (e.g. `maamsamcstr1234`) shows "already bound" for the person who should actually own it — meaning someone else claimed it by mistake, or it was bound during testing — only you, as the Firebase project owner, can release it, since it's a one-time-lock by design:

1. Open **Firebase Console → Build → Realtime Database → Data**.
2. Navigate to `cstr-class-record-bindings → <the legacy code, e.g. maamsamcstr1234>`.
3. Check the `boundEmail` field — confirm it's really the wrong account before touching anything.
4. Delete that one node (click the ⋮ menu next to it → **Remove**, or select it and click the trash icon).
5. Optionally also delete the matching orphaned profile at `cstr-class-record-users → <that boundUid>` if it has no real class data of its own.
6. The legacy code is now unclaimed again — the correct teacher can claim it fresh using Section 5 above.

---

## 9. Zero Cost & 2FA Guarantee

- **Cost**: 100% free forever on the Firebase Spark plan (includes 10 GB/month database traffic and 50,000 monthly active users).
- **2FA**: Google-based sign-ins get 2FA via Google's own account security (Authenticator, Prompt, or Gmail codes) at zero cost. Email/password sign-ins rely on the password itself plus Firebase's built-in rate-limiting on repeated failed attempts — if a teacher wants Google-level 2FA, Google Sign-In (or adding a password via Settings alongside it) remains available.