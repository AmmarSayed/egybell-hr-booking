import {createHash, randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const initialWindows = [
  {date: '2026-11-24', room: 'Meeting Room 9', start: '09:00', end: '17:00'},
  {date: '2026-11-24', room: 'Meeting Room 12', start: '09:00', end: '17:00'},
  {date: '2026-11-25', room: 'Meeting Room 10', start: '09:00', end: '17:00'},
  {date: '2026-11-25', room: 'Meeting Room 14', start: '09:00', end: '17:00'},
];
const sessionMinutes = 15;
export const changeWindowHours = 24;
const changeWindowMs = changeWindowHours * 60 * 60 * 1000;
const cairoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Converts a Cairo wall-clock date and time to a UTC timestamp, following Egypt's daylight saving rules. */
export function cairoTimestamp(date, time) {
  const wallClock = Date.parse(date + 'T' + time + ':00Z');
  let guess = wallClock;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(cairoParts.formatToParts(new Date(guess)).map(({type, value}) => [type, value]));
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += wallClock - shown;
  }
  return guess;
}

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toMinutes(time) {
  if (typeof time !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) return NaN;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function toTime(minutes) {
  return [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2, '0')).join(':');
}

function makeSlots(windows) {
  if (!Array.isArray(windows) || windows.length > 100) {
    throw new RequestError(400, 'Enter up to 100 schedule rows.');
  }
  const slots = new Map();
  const normalized = windows.map((window, index) => {
    const {date, start, end} = window ?? {};
    const room = typeof window?.room === 'string' ? window.room.trim() : '';
    const first = toMinutes(start);
    const last = toMinutes(end);
    const row = index + 1;
    if (!isDate(date) || !room || room.length > 80 || /[\x00-\x1f\x7f]/.test(room)) {
      throw new RequestError(400, 'Enter a valid date and room on row ' + row + '.');
    }
    if (!Number.isFinite(first + last) || first >= last || first % sessionMinutes || last % sessionMinutes) {
      throw new RequestError(400, 'Use 15-minute boundaries and an end time after the start on row ' + row + '.');
    }
    for (let minute = first; minute < last; minute += sessionMinutes) {
      const time = toTime(minute);
      const key = JSON.stringify([date, room.toLowerCase(), time]);
      if (slots.has(key)) throw new RequestError(400, 'Schedule rows overlap for ' + room + ' on ' + date + '.');
      const id = createHash('sha256').update(key).digest('hex');
      slots.set(key, {id, date, room, time});
    }
    return {date, room, start, end};
  });
  return {slots: [...slots.values()], windows: normalized};
}

export function workEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[a-z0-9][a-z0-9._%+~-]*@afreximbank\.com$/.test(email)) {
    throw new RequestError(400, 'Use your @afreximbank.com work email.');
  }
  return email;
}

function phoneNumber(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const phone = raw.replace(/[ ()-]/g, '');
  if (!/^[+0-9 ()-]+$/.test(raw) || !/^\+?[0-9]{7,15}$/.test(phone)) {
    throw new RequestError(400, 'Enter a valid phone number, including country code.');
  }
  return phone;
}

export function openStore(databasePath, {now = () => Date.now()} = {}) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY CHECK(id = 1), windows TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, room TEXT NOT NULL, time TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0, 1))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bookings (
      reference TEXT PRIMARY KEY, slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
      email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, room TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
  `);

  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function saveSchedule(windows, revision) {
    const next = makeSlots(windows);
    return transaction(() => {
      const current = db.prepare('SELECT windows FROM schedule WHERE id = 1').get()?.windows;
      if (revision !== undefined && revision !== revisionOf(current)) {
        throw new RequestError(409, 'The schedule changed. Reload the page and try again.');
      }
      db.prepare('DELETE FROM slots WHERE id NOT IN (SELECT slot_id FROM bookings)').run();
      db.prepare('UPDATE slots SET active = 0').run();
      const add = db.prepare(`
        INSERT INTO slots (id, date, room, time, active) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT (id) DO UPDATE SET active = 1, room = excluded.room
      `);
      for (const {id, date, room, time} of next.slots) add.run(id, date, room, time);
      const json = JSON.stringify(next.windows);
      db.prepare('INSERT INTO schedule VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET windows = excluded.windows').run(json);
      return {windows: next.windows, revision: revisionOf(json)};
    });
  }

  const changeable = (date, time) => cairoTimestamp(date, time) - now() >= changeWindowMs;
  const bookingByEmail = db.prepare(`
    SELECT reference, slot_id, date, time, bookings.room AS room
    FROM bookings JOIN slots ON slots.id = bookings.slot_id WHERE email = ?
  `);
  const bookingView = booking => ({
    id: booking.reference, slot: booking.slot_id, canCancel: changeable(booking.date, booking.time),
    details: {id: booking.slot_id, date: booking.date, time: booking.time, room: booking.room, available: false},
  });

  function revisionOf(json) {
    return createHash('sha256').update(json ?? '').digest('hex');
  }

  if (!db.prepare('SELECT id FROM schedule WHERE id = 1').get()) {
    try {
      saveSchedule(initialWindows, revisionOf(undefined));
    } catch (error) {
      if (!(error instanceof RequestError) || error.status !== 409) throw error;
    }
  }

  return {
    close: () => db.close(),
    dates: () => db.prepare('SELECT DISTINCT date FROM slots WHERE active = 1 ORDER BY date').all().map(row => row.date),
    availability(rawEmail, {includeBooking = false} = {}) {
      const email = workEmail(rawEmail);
      const result = db.prepare(`
        SELECT slots.*, bookings.slot_id IS NULL AS available
        FROM slots LEFT JOIN bookings ON bookings.slot_id = slots.id
        WHERE active = 1
        ORDER BY date, room COLLATE NOCASE, time
      `).all();
      const booking = bookingByEmail.get(email);
      return {
        email,
        slots: result.map(({id, date, time, room, available}) => ({
          id, date, time, room, available: Boolean(available) && changeable(date, time),
        })),
        hasBooking: Boolean(booking),
        ...(includeBooking && booking && {booking: bookingView(booking)}),
      };
    },
    book({email: rawEmail, phone: rawPhone, slotId}) {
      const email = workEmail(rawEmail);
      const phone = phoneNumber(rawPhone);
      if (typeof slotId !== 'string' || !/^[0-9a-f]{64}$/.test(slotId)) {
        throw new RequestError(400, 'Please choose a valid slot.');
      }
      return transaction(() => {
        const existing = db.prepare('SELECT reference, slot_id, phone, room FROM bookings WHERE email = ?').get(email);
        if (existing && (existing.slot_id !== slotId || existing.phone !== phone)) {
          throw new RequestError(409, 'You already have an appointment. Each employee can book once.');
        }
        const slot = db.prepare('SELECT id, date, room, time, active FROM slots WHERE id = ?').get(slotId);
        if (existing) {
          const {id, date, time} = slot;
          return {id: existing.reference, slot: slotId, details: {id, date, time, room: existing.room}};
        }
        if (!slot?.active) throw new RequestError(400, 'That slot is no longer available. Refresh availability.');
        if (!changeable(slot.date, slot.time)) {
          throw new RequestError(400, 'Appointments must be booked at least ' + changeWindowHours + ' hours in advance. Choose a later time.');
        }
        const {id, date, room, time} = slot;
        const details = {id, date, room, time};
        if (db.prepare('SELECT 1 FROM bookings WHERE slot_id = ?').get(slotId)) {
          throw new RequestError(409, 'This slot was just booked. Refresh availability and choose another.');
        }
        const referenceExists = db.prepare('SELECT 1 FROM bookings WHERE reference = ?');
        let reference;
        do {
          reference = randomBytes(4).toString('hex').toUpperCase();
        } while (referenceExists.get(reference));
        db.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?)').run(reference, slotId, email, phone, room, new Date(now()).toISOString());
        return {id: reference, slot: slotId, details, canCancel: true};
      });
    },
    schedule() {
      const {windows} = db.prepare('SELECT windows FROM schedule WHERE id = 1').get();
      return {windows: JSON.parse(windows), revision: revisionOf(windows)};
    },
    saveSchedule,
    cancel(rawEmail) {
      const email = workEmail(rawEmail);
      return transaction(() => {
        const booking = bookingByEmail.get(email);
        if (!booking) throw new RequestError(404, 'You have no appointment to cancel.');
        if (!changeable(booking.date, booking.time)) {
          throw new RequestError(409, 'Appointments can only be cancelled up to ' + changeWindowHours + ' hours before. Please contact HR.');
        }
        db.prepare('DELETE FROM bookings WHERE reference = ?').run(booking.reference);
        return {cancelled: booking.reference};
      });
    },
    deleteBooking(reference) {
      if (typeof reference !== 'string' || !/^[0-9A-F]{8}$/.test(reference)) {
        throw new RequestError(400, 'Choose a valid booking to delete.');
      }
      const {changes} = db.prepare('DELETE FROM bookings WHERE reference = ?').run(reference);
      if (!changes) throw new RequestError(404, 'That booking was already deleted. Refresh the list.');
      return {deleted: reference};
    },
    bookings(from, to) {
      return db.prepare(`
        SELECT reference, email, phone, date, time, bookings.room AS room, created_at AS createdAt
        FROM bookings JOIN slots ON slots.id = bookings.slot_id
        WHERE date >= ? AND date <= ?
        ORDER BY date, time, room COLLATE NOCASE
      `).all(from || '0000-01-01', to || '9999-12-31');
    },
  };
}
