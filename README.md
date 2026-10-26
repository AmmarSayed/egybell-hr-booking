# Egybell HR Booking

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
