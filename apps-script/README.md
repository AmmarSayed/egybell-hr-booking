# Afreximbank appointment booking

Current flow: enter an @afreximbank.com work email, choose an available slot, confirm. Email ownership is not verified. No employee list, verification codes, Microsoft integration, WhatsApp integration, or outgoing emails are required.

Backend: https://docs.google.com/spreadsheets/d/1qHKeZ3SGE4BYEtuYVTAc23K-lfpmBitk4OETfPPNwgg/edit

Install Code.gs and Index.html in one Google Apps Script project (HTML file named Index). Deploy a web app executing as the owner. Employees need access to the web app, not the private spreadsheet. The owner must authorize spreadsheet access; no MailApp scope is needed. Live deployment and concurrency verification remain required.

The server enforces the exact email domain and normalizes email case/whitespace. It takes a script lock, rereads the sheet, checks for an existing booking under the email and for a taken slot, writes and flushes before releasing the lock. Repeating the same email/slot request returns its saved reference. This prevents duplicate bookings per submitted email, not impersonation or one person using multiple email addresses. Anyone entering another employee's address can affect that employee's booking eligibility.

Rooms and Available_Slots are the authoritative availability tables. Settings edits do not regenerate slots automatically. To change dates/hours, update Available_Slots consistently and preserve already booked IDs. Disable rooms with Rooms.Is_Active and slots with Slot_Enabled. Bookings rows marked Cancelled release the slot and submitted email. Cancellation/rescheduling UI is not implemented. Make manual administrator changes while booking traffic is paused; direct sheet edits and other script projects bypass this project's lock.

Local tests cover domain checking, booking without a roster, duplicate prevention, idempotent retries, disabled slots, cancelled bookings and availability response privacy. Google services are simulated. Before launch, test two real browser sessions trying the same slot at the same time and confirm exactly one row is saved. Also test request retries, an email's second booking in another room/date, quota/busy errors, mobile layout and the live confirmation page.
