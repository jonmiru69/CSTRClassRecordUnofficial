# Setting Up Live Sync & Google Authentication (Firebase)

This web application uses **Firebase Realtime Database** with **Firebase Authentication (Google Sign-In)**. Every teacher signs in securely with their Google Account (which automatically supports 2-Step Verification / 2FA via Google Authenticator, Google Prompt, or Gmail at **zero cost**).

This is a one-time configuration done by the site owner/developer in the Firebase and Google Cloud consoles.

---

## 1. Enable Google Sign-In (Authentication)

1. Open the [Firebase Console](https://console.firebase.google.com/) and select your project (`cstr-class-record-global`).
2. In the left navigation bar, open **Build → Authentication**.
3. Go to the **Sign-in method** tab.
4. If you see **Google**, click on it (or click **Add new provider → Google**):
   - Toggle **Enable** to ON.
   - Under **Project support email**, select your email from the dropdown.
   - Click **Save**.
5. If **Anonymous** was previously enabled:
   - Click **Anonymous**, toggle it **Disabled**, and click **Save**. *(This blocks anonymous internet bots from accessing your database).*

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
4. Under **Set application restrictions**, choose **Websites (HTTP referrers)**:
   - Add `https://jonmiru69.github.io/*`
   - Add `http://localhost/*`
5. Under **API restrictions**, choose **Restrict key**:
   - Check **Firebase Realtime Database API**
   - Check **Identity Toolkit API** *(needed for Firebase Auth)*
   - Check **Token Service API**
6. Click **Save**.

Now, even though the web config is committed to your frontend repository, the key is mathematically restricted to your approved website domains only.

---

## 5. How Existing Teachers Claim & Secure Their Accounts

Teachers who had accounts prior to this security upgrade (`harty342002`, `maamsamcstr1234`, `lycalikezone67`, `shervibels00`) have their data safely preserved in Firebase.

To link and protect their account:
1. The teacher visits the deployed website.
2. Below the main button, click:
   **"Have an existing account created before this upgrade? Click here"**
3. Enter their previous account code.
4. Click **"🔐 Link & Secure with Google"**.
5. Sign in with their Google/Gmail account.
6. The app instantly binds their Google Account to their existing class records! All their classes, learners, and grades load immediately without losing anything.
7. **From that second onward**:
   - Their account is permanently locked to their Google Account.
   - If anyone tries to enter their old password on the website, the site **blocks direct password login** and displays:
     > *"🔒 ACCOUNT PROTECTED WITH 2FA: This account is permanently bound to Google Account (h***@gmail.com). Please sign in with Google."*

---

## 6. How New Teachers Sign Up (Automated Self Sign-Up)

You, the developer, no longer need to manually edit `app.js` or push commits to create new accounts:

1. Any teacher opens the website.
2. Clicks **"Sign in with Google"**.
3. If they are a new teacher, the app displays:
   > *"Welcome to CSTR Class Record! Set up your account"*
4. They type their full name and click **"✨ Create My Class Record"**.
5. Their personal, isolated class record is created instantly with a clean workspace ready for "+ Add Class".

---

## 7. Zero Cost & 2FA Guarantee

- **Cost**: 100% free forever on the Firebase Spark plan (includes 10 GB/month database traffic and 50,000 monthly active users).
- **2FA**: Handled directly by Google's account security (Google Authenticator, Google Prompt, or Gmail verification codes) without expensive SMS fees.