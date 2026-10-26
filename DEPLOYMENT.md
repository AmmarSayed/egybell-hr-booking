# Live deployment

Website: https://egybell-hr-booking.ammarsayed1988.workers.dev

Cloudflare Worker: egybell-hr-booking
Version: e8951802-4f4d-403c-a9ae-51d915a7c41c

Google Apps Script deployment: version 4. Google Sheets remains the database. No emails are sent. Staff enter their work email and phone, choose an appointment, review, confirm, then screenshot or download a PNG receipt.

Validation: TypeScript and production build passed; seven backend tests passed. The website was opened successfully in Chrome. A local end-to-end test wrote a booking, confirmed its phone number in Google Sheets, and downloaded a visually inspected receipt. That temporary test booking was marked Cancelled, with an HR_Notes explanation, leaving the slot available again. Existing employee booking was retained.

Future updates: npm run build; node build-worker.mjs; npx wrangler deploy. Google service changes require publishing a new Apps Script version, preserving the existing deployment URL.

Rebranded for Egybell. The previous URL also serves the updated branding. The Afreximbank email restriction remains by explicit user request.

Available-only appointment display deployed as version 6e6b2367-5edf-46ac-a620-2709efab0100. New booking references are eight uppercase hexadecimal characters and checked against all historical booking IDs, including cancelled records. Existing references are unchanged.

Current Egybell Worker version: 3677f3a9-d02e-40ce-8039-311667564c95. Confirmation button shows a spinning LoaderCircle and live status text while saving. Apps Script version 5 uses deployment AKfycbzi64ASc30V_qrYkCz2sI_nrlTtmpMkfUD9QE0w_hvNzdXNzCQuvAoCeddDBnFufFe0PA. Live short-reference test returned FB3A70E1; the test booking was cancelled and annotated. Nine backend tests pass.

Mobile layout compacted for approximately 800px-high screens. First details screen and review screen verified at 390x800 with no horizontal overflow. Intro hidden after the first step. Current Worker version: 7dc5fe65-1527-405d-9478-e579380f51ff.

Desktop laptop-height layout compacted; first screen verified with pageHeight = viewportHeight = 768 at 1366x768 and no horizontal overflow. Worker version 4cd27efe-084c-4b53-861b-24fda369a1f5.

Final laptop-height refinement: Worker 4fc2e645-e559-4f42-8ce8-efb8a346f641 tightens slot-selection card spacing. Details and review measured at 1366x768 with document height exactly 768. Mobile overrides remain separate.
