# OKV School — Teaching Studio school system

Everything you need to run the school: a Google Apps Script backend (one file), and a static web app (the `site` folder) that you host anywhere with HTTPS.

## Folder layout

```
Code.gs          Backend. Paste into Apps Script (bound to a Google Sheet).
site/            The web app. Upload this whole folder to any HTTPS static host.
  index.html     Sign-in (every role)
  install.html   Install page for the share links, then sign-in
  admin.html     Administrator dashboard (teachers, classes, subjects, students, share)
  teacher.html   Teacher dashboard (classes, students, attendance, announcements, marks, share)
  student.html   Student dashboard (subjects, announcements, attendance, marks, tests)
  tests.html     Test builder and results (teachers and administrator)
  take.html      Students take tests
  live.html      Live board (teacher and student, with pen hand-over, pages, eraser, PNG)
  common.js      Shared code. Set API_URL here.
  sw.js, manifest.webmanifest, icon-192.png, icon-512.png   Installable app and offline shell
test/            Automated tests (see below)
```

## 1. Set up the backend (once)

1. Create a new Google Sheet. Extensions → Apps Script. Paste `Code.gs`. Save.
2. Select `createDatabase` and Run. Approve access. This creates the sheets.
3. Edit the name, email and password at the bottom of `createAdmin`, then select `createAdmin` and Run once. **Change the default password first.** This is the school administrator's account.
4. Deploy → New deployment → Web app. Execute as: **Me**. Who has access: **Anyone**. Copy the `/exec` URL.
5. Open `site/common.js` and replace `PASTE_APPS_SCRIPT_EXEC_URL_HERE` with that URL.

Anything placed in `common.js` is public. The backend therefore has no shared key; security rests on the account passwords and the rules in `Code.gs`.

## 2. Host the web app

Upload the `site` folder to an HTTPS host, such as GitHub Pages or Netlify (drag and drop). Installing the app and offline support require HTTPS (or `localhost` for testing).

After you change the site files, students may need to reload once to get the update (the app caches its shell).

## 3. How people use it

**Administrator** (signs in with the account from `createAdmin`):
- Creates teachers, classes, subjects (each subject has a class and a teacher), and students (each has a class).
- Can do everything a teacher can, for every class: announcements, attendance, marks, tests, live boards. Open the teacher workspace from the header.
- Shares the install link with teachers from the **Share** tab.

**Teacher** (account created by the administrator):
- Sees only their own classes and subjects.
- Shares the install link with students from the **Share** tab.

**Share links:** the link opens `install.html`.
1. The person installs the app (Chrome/Edge show an install button; iPhone and Android show short instructions).
2. When the install finishes, the page moves on to sign-in by itself. A "Continue to sign in" button is always there too.
3. The person signs in with the email and password given to them.

Links for teachers (`install.html?for=teacher`) and students (`install.html?for=student`) show different wording. Each share panel has Copy, WhatsApp and (where supported) the system share sheet.

## 4. Tests

The tests run the real `Code.gs` in Node with an in-memory copy of the Apps Script services, and drive the pages in headless Chromium.

- `test/backend_test.js` — every role's permissions (no browser needed): `node test/backend_test.js`
- `test/smoke.js` — loads each page against a stub API
- `test/e2e_server.js` — serves `site` and runs `Code.gs` on port 8802 (start it first)
- `test/e2e_dashboards.js`, `test/e2e_live.js`, `test/e2e_features.js`, `test/e2e_install.js` — browser flows (run each one against a fresh `e2e_server.js`)

Setup: `npm install -g playwright`, and point `executablePath` in the tests at your Chromium (they currently use `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Run with `NODE_PATH=$(npm root -g)`.

## Known limits

- Accounts and data live in a Google Sheet. That is convenient, but it is not production-grade for sensitive records.
- The live board polls about every 1.2 seconds, so strokes can take a moment to appear.
- Live board images are not synced. Text uses the browser's prompt box.
- Each save reads the whole sheet, so the system slows down as data grows.
- A student belongs to one class.
- Classes, subjects and students can be switched off but not deleted.
- The administrator cannot take a student's own pages (tests, own marks) because those are the student's record.
