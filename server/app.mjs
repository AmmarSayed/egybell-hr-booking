import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import express from 'express';
import {isDate, openStore, RequestError} from './store.mjs';

const sessionSeconds = 8 * 60 * 60;
const cookieName = 'egybell_hr';
const reportColumns = [
  ['Booking reference', 'reference'], ['Full name', 'name'], ['Work email', 'email'], ['Phone number', 'phone'],
  ['Appointment date', 'date'], ['Cairo time', 'time'], ['Meeting room', 'room'],
  ['Booked at (UTC)', 'createdAt'],
];

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function csvCell(value) {
  const text = String(value);
  const safe = /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function createBookingApp({databasePath, adminPassword, secure = false, staticDir = 'dist', bookingAuth = null, now}) {
  if (typeof adminPassword !== 'string' || adminPassword.length < 16 || adminPassword.length > 256) {
    throw new Error('Set ADMIN_PASSWORD to a strong password between 16 and 256 characters.');
  }
  const store = openStore(databasePath, {now});
  const expectedPassword = digest(adminPassword);
  const sessions = new Map();
  const cookieOptions = {httpOnly: true, sameSite: 'strict', secure, path: '/api/admin'};
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', secure ? 1 : false);
  app.use((_req, res, next) => {
    res.set({'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'});
    next();
  });

  const api = express.Router();
  app.use('/api', api);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({limit: '24kb'}));
  api.use((req, _res, next) => {
    if (req.method === 'POST' && (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      throw new RequestError(400, 'Send a JSON object.');
    }
    next();
  });
  api.get('/health', (_req, res) => res.json({ok: true}));
  api.get('/booking-auth', (_req, res) => res.json({publishableKey: bookingAuth?.publishableKey ?? null}));
  api.post('/booking', async (req, res) => {
    const body = req.body;
    if (body.action === 'schedule') return res.json({dates: store.dates()});
    if (!['availability', 'book', 'cancel'].includes(body.action)) {
      throw new RequestError(400, 'Invalid booking request.');
    }
    // Cancelling needs proof of identity, so it is unavailable when emails are self-reported.
    if (body.action === 'cancel' && !bookingAuth) throw new RequestError(403, 'Sign in to cancel your appointment.');
    const email = bookingAuth ? await bookingAuth.verifiedEmail(req.get('authorization')) : body.email;
    if (body.action === 'cancel') return res.json(store.cancel(email));
    // Booking details are only returned to a verified Clerk identity, never to a typed-in email.
    if (body.action === 'availability') return res.json(store.availability(email, {includeBooking: Boolean(bookingAuth)}));
    return res.json(store.book({...body, email}));
  });

  const admin = express.Router();
  api.use('/admin', admin);
  const failedLogins = new Map();
  const failureWindow = 15 * 60 * 1000;
  admin.post('/login', (req, res) => {
    const now = Date.now();
    for (const [ip, state] of failedLogins) if (state.until <= now) failedLogins.delete(ip);
    const ip = req.ip;
    const state = failedLogins.get(ip);
    if (state?.count >= 8) throw new RequestError(429, 'Too many attempts. Try again in 15 minutes.');
    const {password} = req.body;
    if (typeof password !== 'string' || password.length > 256 || !timingSafeEqual(expectedPassword, digest(password))) {
      failedLogins.set(ip, {count: (state?.count ?? 0) + 1, until: state?.until ?? now + failureWindow});
      throw new RequestError(401, 'Incorrect administrator password.');
    }
    failedLogins.delete(ip);
    for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, now + sessionSeconds * 1000);
    res.cookie(cookieName, token, {...cookieOptions, maxAge: sessionSeconds * 1000}).json({ok: true});
  });
  admin.use((req, _res, next) => {
    const token = req.headers.cookie?.match(/(?:^|;\s*)egybell_hr=([a-f0-9]{64})(?:;|$)/)?.[1];
    if ((sessions.get(token) ?? 0) <= Date.now()) throw new RequestError(401, 'Sign in to manage appointments.');
    req.adminToken = token;
    next();
  });
  admin.post('/logout', (req, res) => {
    sessions.delete(req.adminToken);
    res.clearCookie(cookieName, cookieOptions).json({ok: true});
  });
  admin.get('/schedule', (_req, res) => res.json(store.schedule()));
  admin.post('/schedule', (req, res) => {
    if (typeof req.body.revision !== 'string') throw new RequestError(400, 'Reload the schedule and try again.');
    res.json(store.saveSchedule(req.body.windows, req.body.revision));
  });

  function filteredBookings(req) {
    const {from, to} = req.query;
    if ((from !== undefined && !isDate(from)) || (to !== undefined && !isDate(to)) || (from && to && from > to)) {
      throw new RequestError(400, 'Enter a valid date range.');
    }
    return store.bookings(from, to);
  }

  admin.get('/bookings', (req, res) => res.json({bookings: filteredBookings(req)}));
  admin.post('/bookings/delete', (req, res) => res.json(store.deleteBooking(req.body.reference)));
  admin.get('/report.csv', (req, res) => {
    const bookings = filteredBookings(req);
    const rows = [reportColumns.map(([label]) => label), ...bookings.map(row => reportColumns.map(([, key]) => row[key]))];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    res.set('Content-Disposition', 'attachment; filename="egybell-bookings.csv"').type('text/csv').send(csv);
  });
  api.use((_req, res) => res.status(404).json({error: 'API route not found.'}));

  const root = resolve(staticDir);
  app.use(express.static(root, {index: false}));
  app.get(['/', '/admin', '/admin/'], (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(resolve(root, 'index.html')));
  app.use((error, _req, res, _next) => {
    if (error instanceof RequestError) return res.status(error.status).json({error: error.message});
    if (error.type === 'entity.parse.failed') return res.status(400).json({error: 'Invalid JSON.'});
    if (error.type === 'entity.too.large') return res.status(413).json({error: 'This request is too large.'});
    if (error.status === 404) return res.status(404).json({error: 'Page not found. Build the app before starting the server.'});
    console.error('Booking server request failed:', error.code ?? error.name);
    res.status(500).json({error: 'The booking service could not complete the request. Please try again.'});
  });
  return {app, close: store.close};
}
