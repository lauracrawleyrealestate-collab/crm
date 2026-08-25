# Setting up your CRM — start to finish

Three things to do, in this order. Budget about 25 minutes for the first two.
You only ever do this once.

1. **Put the app online** (GitHub) — 10 min
2. **Connect it to your Google account** (Google Cloud) — 15 min
3. **Add it to your phone** — 1 min

Do them in order: step 2 needs the web address you get in step 1.

---

## Part 1 — Put the app online (GitHub)

GitHub is free and this is the only thing it's being used for: holding the files
and serving them as a web page.

### 1.1 Create the account

1. Go to **https://github.com/signup**
2. Enter your email, pick a password, pick a username.
   - Your username becomes part of your CRM's web address, so pick something
     clean — `lauracrawley` or `crawleyrealestate` rather than something random.
3. Solve the puzzle it gives you, then enter the code it emails you.
4. When it asks about a plan, choose **Free**.

### 1.2 Create the repository

A "repository" (repo) is just a folder of files.

1. Once signed in, click the **+** in the top-right → **New repository**.
2. **Repository name:** `crm`
3. Set it to **Public**.
   - It has to be public for free hosting. That is fine — *none of your client
     data is in these files.* The files are only the app itself; your contacts
     and deals live in your Google Drive, which stays private. See the note at
     the bottom of this guide.
4. Leave everything else alone. Click **Create repository**.

### 1.3 Upload the app files

1. On the new empty repo page, click the link **uploading an existing file**.
2. Drag in **everything from the `crm` folder** I sent you — `index.html`,
   `manifest.json`, and the `css`, `js`, and `icons` folders.
   - Drag the folders themselves; GitHub keeps the structure.
3. Scroll down, click **Commit changes**.

### 1.4 Turn on the web hosting

1. In the repo, click **Settings** (top right of the repo, not your account settings).
2. In the left sidebar, click **Pages**.
3. Under **Branch**, change `None` to **main**, leave the folder as `/ (root)`,
   click **Save**.
4. Wait 1–2 minutes, then refresh. A green box appears with your address:

   ```
   https://YOUR-USERNAME.github.io/crm/
   ```

**Write that address down.** You need it in the next part.

If you open it now it will load and tell you it isn't connected to Google yet.
That's expected — that's Part 2.

---

## Part 2 — Connect it to your Google account

This is what lets the CRM read and write your own Sheets, Gmail, Calendar and Drive.
Use the **same Google account** you want the CRM to live in.

### 2.1 Create a project

1. Go to **https://console.cloud.google.com/**
2. Sign in with your Google account. Accept the terms if asked.
   - It may ask about a free trial or billing. **You do not need to enable billing.**
     Skip or dismiss it. Everything here is free.
3. At the very top, click the project dropdown → **New Project**.
4. Name it `Laura CRM`. Click **Create**.
5. Wait a few seconds, then make sure that project is selected in the top dropdown.

### 2.2 Turn on the four APIs

For each of the four below: use the search bar at the top of the console, type the
name, click the result, then click the blue **Enable** button.

- `Google Sheets API`
- `Google Drive API`
- `Gmail API`
- `Google Calendar API`

Wait for each one to finish before starting the next.

### 2.3 Set up the consent screen

This is the "Do you allow this app to access your Google account?" screen that
you'll see when you sign in. You're setting up your own.

1. In the left menu, go to **APIs & Services** → **OAuth consent screen**.
   (Google now calls this section the **Google Auth Platform**.)
2. Click **Get started** and fill in the short wizard:
   - **App name:** `Crawley CRM`
   - **User support email:** your email
   - **Audience:** choose **External**
   - **Contact information:** your email
   - Tick the box to agree, click **Create**.

### 2.4 Add yourself as a test user

The app stays in "Testing" mode. That's deliberate — it means only accounts you
list can use it, and you skip Google's app-review process entirely.

1. Click the **Audience** tab.
2. Under **Test users**, click **Add users**.
3. Enter your own Gmail address. Click **Save**.

> If you ever want to use the CRM from a second Google account, add it here.

### 2.5 Add the permissions the app needs

1. Click the **Data access** tab.
2. Click **Add or remove scopes**.
3. In the **Manually add scopes** box at the bottom, paste this whole block:

   ```
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/calendar.events
   ```

4. Click **Add to table**, then **Update**, then **Save**.

What each one does, plainly:

| Permission | What it lets the CRM do |
|---|---|
| `spreadsheets` | Read and write your CRM spreadsheet |
| `drive.file` | Create the CRM folder and files — **only files it made itself**, nothing else in your Drive |
| `gmail.readonly` | Show you email threads with a contact |
| `gmail.send` | Send an email from a contact card |
| `calendar.events` | Put showings and appointments on your calendar |
| `userinfo.*`, `openid` | Know your name and email so it can greet you |

### 2.6 Create the Client ID

1. Click the **Clients** tab → **Create client**.
2. **Application type:** `Web application`
3. **Name:** `CRM Web`
4. Under **Authorized JavaScript origins**, click **Add URI** and enter your
   GitHub address **without the `/crm/` part and without a trailing slash**:

   ```
   https://YOUR-USERNAME.github.io
   ```

   > This matters. It is what stops anyone else's website from using your Client ID.

5. Leave **Authorized redirect URIs** empty — this app doesn't use them.
6. Click **Create**.
7. A box shows your **Client ID**. It looks like
   `918273645102-a1b2c3....apps.googleusercontent.com`. **Copy it.**

---

## Part 3 — Paste in the Client ID

1. Go back to your GitHub repo → open the `js` folder → click `config.js`.
2. Click the **pencil icon** (Edit) at the top right of the file.
3. Find this line near the top:

   ```js
   GOOGLE_CLIENT_ID: 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
   ```

4. Replace everything between the quotes with your Client ID:

   ```js
   GOOGLE_CLIENT_ID: '918273645102-a1b2c3....apps.googleusercontent.com',
   ```

   Keep the quotes and the comma.

5. Click **Commit changes** → **Commit changes** again.
6. Wait about a minute, then open `https://YOUR-USERNAME.github.io/crm/`
7. Click **Sign in with Google**.
   - You'll see a warning: **"Google hasn't verified this app."** That is expected —
     it's *your* app, unverified because you skipped the review process you don't
     need. Click **Advanced** → **Go to Crawley CRM (unsafe)**.
   - Approve the permissions.

The first time it loads, it creates a spreadsheet called **Laura CRM Data** in your
Google Drive. That's your database. You're live.

---

## Part 4 — Put it on your phone

**iPhone:** open the address in **Safari** (it must be Safari) → tap the Share
button → **Add to Home Screen**.

**Android:** open it in Chrome → menu (⋮) → **Add to Home screen**.

It gets an icon and opens full-screen like a real app. Sign in with Google once
on the phone and you're done.

---

## Things worth knowing

**Where your data actually is.** One Google Sheet called `Laura CRM Data` and one
folder called `Laura CRM Documents`, both in your own Drive. Open the sheet any
time — Settings tab in the CRM has a direct link. You can edit it by hand, sort
it, download it. The app is just a nicer window onto it.

**Why a public repo is safe here.** The repo holds the app's code, not your data.
The Client ID in `config.js` is not a password — it's designed to be public, and
it only works from your own web address because of the origin you set in step 2.6.
Anyone can read the code; nobody can read your contacts.

**Signing in again.** You'll be asked to sign in fresh now and then. That's normal
for an app in Testing mode. It's one tap.

**Backups.** The Settings tab has "Download CSV backup." Your data is already in
Google Drive with its own version history, but a copy on your laptop now and then
doesn't hurt.

**If something breaks.** Check the browser address is exactly right, and that
`config.js` still has your Client ID. If sign-in fails specifically, the usual
cause is a mismatch between the GitHub address and the "Authorized JavaScript
origins" value in step 2.6.
