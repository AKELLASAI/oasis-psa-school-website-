# Oasis Preschool Academy – website + school app

## Technical stack
| Layer | What it uses |
|---|---|
| Front end | One file, `index.html`: plain HTML, CSS and JavaScript (no framework). Public website + school app (opens at `#/login`) |
| Back end | `server.js`: Node.js 22+ with only built-in modules (no `npm install` needed) |
| Database | SQLite through Node's built-in `node:sqlite`, saved in `data/oasis.db` |
| Files | Homework attachments and photos in `data/uploads/` (only signed-in users can open them) |
| Login | Email + 6-digit OTP. Codes expire after 5 minutes, 5 tries allowed, 30 s between resends. Session cookie is HttpOnly and lasts 12 hours |
| Email | Built-in SMTP client (Gmail or any SMTP provider), set in `config.json` |

## Files in this folder
- `index.html` – website and all app screens
- `server.js` – web server, API, database, OTP email
- `Start Website.command` – double-click to start on a Mac
- `logo.png`, `logo-icon.png` – school logo
- `config.json` – settings (created the first time it runs)
- `data/` – database and uploads (created the first time it runs). **Back up this folder.**

## First run
1. Install Node.js 22 or newer from nodejs.org if it is not already installed.
2. Double-click **Start Website.command**.
3. Click **Staff login** and sign in with `oasispsa@gmail.com` (the first Administrator).
   Until email is set up, the code appears on the login screen (demo mode).

## Turn on real OTP emails (Gmail)
1. In the school Google account turn on 2-Step Verification, then create an **App password** (Google Account → Security → App passwords).
2. Open `config.json` and fill in:
```json
"smtp": { "host": "smtp.gmail.com", "port": 465, "user": "oasispsa@gmail.com", "pass": "the 16-letter app password", "fromName": "Oasis Preschool Academy" }
```
3. Close the Terminal window and start the app again. Codes are now emailed, never shown on screen.

## Using it on phones (camera for homework)
Phones on the same Wi-Fi can open the address shown in the Terminal window, e.g. `http://192.168.1.20:8000`.
"Take a photo" on the Homework screen opens the phone camera.

## Screens
Dashboard · Attendance · Homework · Students · School details · Classes · Sections · Fee types · Screen master · Role master · User master
