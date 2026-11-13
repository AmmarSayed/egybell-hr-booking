# Egybell HR Booking

## Standalone booking portal

The standalone version serves the employee portal, admin dashboard, and booking API from one URL. SQLite stores the schedule and confirmed bookings. The initial schedule is November 24 and 25, 2026, with the four requested rooms and 15-minute appointments between 09:00 and 17:00 Cairo time.

Open `/admin` to sign in, edit each room and date, or filter bookings and download an Excel-compatible CSV. Removing a time from availability preserves its confirmed bookings in the report.

### Run locally

Use Node.js 24. Set `ADMIN_PASSWORD` in your environment to a strong password of at least 16 characters.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8788/` for booking and `http://127.0.0.1:8788/admin` for administration. The local database is stored in `data/bookings.sqlite`. Run `npm test` to verify both backends.

### Publish on Render

Connect this branch as a Render Blueprint using `render.yaml`. Render asks for `ADMIN_PASSWORD` during setup. The Blueprint provisions a paid web service with a persistent disk. After deployment, use its HTTPS URL for employees and append `/admin` for HR. Try the HTTPS URL from the employee network before sharing it.

### Clerk sign-in before booking

Create a dedicated Clerk application for this booking portal. Enable email verification codes, add `afreximbank.com` under Restrictions → Allowlist, and keep the Clerk Account Portal enabled. The booking page opens a single sign-in-or-up modal: employees enter their work email and a one-time code, with no password or separate registration. In Clerk, turn off passwords and first/last name so the code is the only step. HR's admin login is separate.

Set these variables on the server:

- `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the same Clerk instance. Store the secret in Render's environment settings.
- `BOOKING_ORIGIN` to the exact HTTPS origin visitors use, with no trailing slash. If omitted on Render, the server uses `RENDER_EXTERNAL_URL`.

For local testing, use a development instance with `BOOKING_ORIGIN=http://127.0.0.1:8788` and run the built app with `npm start`. Use a test database. In production the server refuses to start without Clerk keys. Development keys work on the `onrender.com` URL (with a development badge and a 100-user cap); live keys need a custom domain you own, set up in Clerk first. Keep Clerk Test mode disabled in production. Locally, without Clerk credentials, the service uses the plain booking form.

Employees can book only slots that start at least 24 hours later (Cairo time) and can cancel their own appointment up to 24 hours before it, then book again. Cancelling requires Clerk sign-in.

The booking API requires a Clerk session from the configured booking origin when Clerk is enabled. It uses the verified primary `@afreximbank.com` email from Clerk. If Google or phone sign-in is enabled in Clerk, employees still need a verified work address as their primary email before booking.

### Legacy deployment

React + TypeScript + Vite, Tailwind CSS and a shadcn-style Radix button. A single Cloudflare Worker serves the compiled website and forwards `/api/booking` to the existing Google Apps Script service. Google Sheets is the only database.

Run `npm install`, `npm run build`, then `node build-worker.mjs` to produce worker.js for Cloudflare. The alternative Pages Function source is preserved under functions/api/booking.ts. No secrets or API keys are embedded. The public booking endpoints enforce the same email-domain and phone validation as the existing public Apps Script app.

Deploy the updated Code.gs from the apps-script folder as a new version of the existing Google Apps Script deployment before deploying the Worker.

Employees enter their own email and phone, select date/room/time, review and confirm. The server locks, rereads and saves bookings before returning a reference. A browser-generated PNG receipt supports mobile saving or screenshots. No email, PWA, verification-code or employee roster dependencies.

Phone numbers are collected for HR and are not returned in availability or included in the downloadable receipt. This app accepts self-reported work email addresses; it does not verify ownership. Do not add public endpoints that expose booking rows, HR notes or phone numbers.

Live backend data uses Available_Slots and Rooms. Settings does not automatically regenerate slots. Date changes must update Available_Slots while preserving booked slot IDs. Historical bookings remain in Google Sheets for HR export.

## Repository contents

- `src/`: React booking interface.
- `functions/api/booking.ts`: Cloudflare proxy for Google Apps Script.
- `build-worker.mjs` and `wrangler.toml`: Worker build and deployment configuration.
- `apps-script/`: Google Apps Script backend and its alternative HTML interface.
- `tests/booking.test.cjs`: backend tests with simulated Google services.
- `DEPLOYMENT.md`: existing deployment notes.

## Local verification

```sh
npm ci
npm run build
node build-worker.mjs
node --test tests/booking.test.cjs
```

Generated output, local Cloudflare state, credentials and development screenshots are excluded from Git. The live service uses the existing Google spreadsheet; employee booking data is not stored in this repository.
