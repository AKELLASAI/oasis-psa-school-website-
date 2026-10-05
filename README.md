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
- `logo.png`, `logo-icon.png` – school logo (`logo-web.png` is a smaller copy for the website header)
- `admissions.html`, `preschool-gajuwaka.html`, `preschool-duvvada.html`, `te.html` – SEO pages (Admissions, area pages, Telugu), styled by `pages.css`
- `sitemap.xml`, `robots.txt`, `vercel.json` – search engine and Vercel settings
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

## Chatbot ("Ask us" button)
A help chatbot sits in the bottom-right corner of the public website. It runs entirely in the browser: no server, API key or cost, so it also works if the site is hosted without `server.js`.
- Answers questions about classes and ages, admissions 2026–27, documents, fees (types and UPI payment), the school van route and stops, location, contact details, visits, the parent app and login.
- Tell it a child's age ("2 and half years", "30 months", "born 15-06-2022") and it suggests the right class.
- Understands small spelling mistakes, and offers WhatsApp, call and enquiry-form buttons. Anything it can't answer goes to WhatsApp with the question filled in.
- Hidden inside the school app (`#/login`, `#/app`).
- To change its answers, edit the "school facts" and "answers" sections in the chatbot `<script>` at the bottom of `index.html`.
