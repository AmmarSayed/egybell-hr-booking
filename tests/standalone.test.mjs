import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {once} from 'node:events';
import {createBookingApp} from '../server/app.mjs';
import {openStore} from '../server/store.mjs';
import {DatabaseSync} from 'node:sqlite';

test('booking and HR management share a durable database', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'egybell-test-'));
  const databasePath = join(dir, 'bookings.sqlite');
  await writeFile(join(dir, 'index.html'), '<div id="root"></div>');
  const adminPassword = 'test-only-password-123';
  t.after(() => rm(dir, {recursive: true, force: true}));

  async function start() {
    const {app, close} = createBookingApp({databasePath, adminPassword, staticDir: dir, now: () => Date.parse('2026-11-01T00:00:00Z')});
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return {
      request: (path, body, cookie) => fetch('http://127.0.0.1:' + server.address().port + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {...(cookie && {cookie}), ...(body !== undefined && {'content-type': 'application/json'})},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      stop: async () => {
        await new Promise(resolve => server.close(resolve));
        close();
      },
    };
  }

  let instance = await start();
  t.after(() => instance.stop());
  const request = (...args) => instance.request(...args);
  const publicApi = body => request('/api/booking', body);
  const email = 'employee@afreximbank.com';
  const schedule = await (await publicApi({action: 'schedule'})).json();
  assert.deepEqual(schedule.dates, ['2026-11-24', '2026-11-25']);
  assert.equal((await request('/api/admin/report.csv')).status, 401);
  assert.equal((await request('/api/admin/bookings')).status, 401);
  for (const page of ['/admin', '/admin/setup', '/admin/setup/', '/admin/cancellations']) {
    const response = await request(page);
    assert.equal(response.status, 200, page);
    assert.match(await response.text(), /id="root"/);
  }
  assert.equal((await request('/api/admin/login', {password: 'wrong'})).status, 401);
  const login = await request('/api/admin/login', {password: adminPassword});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const slots = (await (await publicApi({action: 'availability', email})).json()).slots;
  assert.equal(slots.length, 128);
  // Without Clerk there is no proof of identity, so cancelling is refused.
  assert.equal((await publicApi({action: 'cancel', email})).status, 403);
  const before = await (await publicApi({action: 'availability', email})).json();
  assert.equal(before.booking, undefined);
  const slotId = slots[0].id;
  const booking = {action: 'book', email, name: 'Mona Hassan', phone: '+201000000001', slotId};
  for (const name of ['', 'M', '<script>', '12345', 'x'.repeat(101)]) {
    assert.equal((await publicApi({...booking, name})).status, 400, 'name ' + JSON.stringify(name));
  }
  const concurrent = await Promise.all([publicApi(booking), publicApi({...booking, email: 'another@afreximbank.com'})]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const winner = (await (await publicApi({action: 'availability', email})).json()).hasBooking ? email : 'another@afreximbank.com';
  const receipt = await (await publicApi({...booking, email: winner})).json();
  assert.match(receipt.id, /^[0-9A-F]{8}$/);
  // Without Clerk the email is self-reported, so booking details must not be returned.
  assert.equal((await (await publicApi({action: 'availability', email: winner})).json()).booking, undefined);
  assert.equal((await publicApi({...booking, email: winner, slotId: slots[1].id})).status, 409);

  const report = async (query, auth = cookie) => (await request('/api/admin/bookings' + query, undefined, auth)).json();
  const firstDay = '?from=2026-11-24&to=2026-11-24';
  const bookedReport = await report(firstDay);
  assert.deepEqual(bookedReport.bookings.map(row => row.reference), [receipt.id]);
  assert.deepEqual(bookedReport.stats, {confirmedBookings: 1, scheduledSlots: 64, bookedScheduledSlots: 1});
  assert.deepEqual(await report('?from=2026-11-25&to=2026-11-25'), {
    bookings: [], stats: {confirmedBookings: 0, scheduledSlots: 64, bookedScheduledSlots: 0},
    pagination: {page: 1, pageSize: 25, total: 0},
  });
  assert.deepEqual(await report('?from=2026-11-27'), {
    bookings: [], stats: {confirmedBookings: 0, scheduledSlots: 0, bookedScheduledSlots: 0},
    pagination: {page: 1, pageSize: 25, total: 0},
  });

  const {windows, revision} = await (await request('/api/admin/schedule', undefined, cookie)).json();
  const current = windows.find(w => w.date === slots[0].date && w.room === slots[0].room);
  const admin = body => request('/api/admin/schedule', {...body, revision}, cookie);
  assert.equal((await admin({windows: [...windows, {...current, date: '2026-02-31'}]})).status, 400);
  assert.equal((await admin({windows: [...windows, {...current, date: '2026-11-26'}]})).status, 200);
  assert.deepEqual((await (await publicApi({action: 'schedule'})).json()).dates, ['2026-11-24', '2026-11-25', '2026-11-26']);

  assert.equal((await admin({windows})).status, 409);

  const csv = await (await request('/api/admin/report.csv?from=2026-11-24&to=2026-11-24', undefined, cookie)).text();
  assert.ok(csv.includes(winner));
  assert.ok(csv.includes(receipt.id));
  assert.ok(csv.includes("'+201000000001"));
  assert.ok(csv.includes('"Full name"') && csv.includes('"Mona Hassan"'));
  const filtered = await (await request('/api/admin/report.csv?from=2026-11-25', undefined, cookie)).text();
  assert.ok(!filtered.includes(receipt.id));

  const edited = await (await request('/api/admin/schedule', undefined, cookie)).json();
  const closed = await request('/api/admin/schedule', {
    ...edited, windows: edited.windows.filter(w => w.date !== current.date || w.room !== current.room),
  }, cookie);
  assert.equal(closed.status, 200);
  const afterClosing = (await (await publicApi({action: 'availability', email: winner})).json()).slots;
  assert.ok(!afterClosing.some(slot => slot.id === slotId));
  const archivedReport = await (await request('/api/admin/report.csv', undefined, cookie)).text();
  assert.ok(archivedReport.includes(receipt.id));
  const afterClosingReport = await report(firstDay);
  assert.deepEqual(afterClosingReport.bookings.map(row => row.reference), [receipt.id]);
  assert.deepEqual(afterClosingReport.stats, {confirmedBookings: 1, scheduledSlots: 32, bookedScheduledSlots: 0});

  await instance.stop();
  instance = await start();
  assert.equal((await (await publicApi({action: 'availability', email: winner})).json()).hasBooking, true);

  const relogin = await request('/api/admin/login', {password: adminPassword});
  const freshCookie = relogin.headers.get('set-cookie').split(';')[0];
  const remove = (reference, auth = freshCookie) => request('/api/admin/bookings/delete', {reference}, auth);
  assert.equal((await remove(receipt.id, null)).status, 401);
  assert.equal((await remove('not-a-ref')).status, 400);
  assert.equal((await remove(receipt.id)).status, 200);
  assert.equal((await remove(receipt.id)).status, 404);
  assert.deepEqual(await report(firstDay, freshCookie), {
    bookings: [], stats: {confirmedBookings: 0, scheduledSlots: 32, bookedScheduledSlots: 0},
    pagination: {page: 1, pageSize: 25, total: 0},
  });
  assert.ok(!(await (await request('/api/admin/report.csv', undefined, freshCookie)).text()).includes(receipt.id));
  const afterDelete = await (await publicApi({action: 'availability', email: winner})).json();
  assert.equal(afterDelete.hasBooking, false);
  const openSlot = afterDelete.slots.find(slot => slot.available);
  const rebooked = await publicApi({action: 'book', email: winner, name: 'Mona Hassan', phone: '+201000000001', slotId: openSlot.id});
  assert.equal(rebooked.status, 200);
  assert.deepEqual((await (await publicApi({action: 'schedule'})).json()).dates, ['2026-11-24', '2026-11-25', '2026-11-26']);

  const nextDaySlots = afterDelete.slots.filter(slot => slot.date === '2026-11-25').slice(0, 26);
  for (const [index, slot] of nextDaySlots.entries()) {
    const response = await publicApi({...booking, slotId: slot.id, email: 'sample.' + index + '@afreximbank.com'});
    assert.equal(response.status, 200);
  }
  const search = '?email=%20SAMPLE.%20';
  const firstPage = await report(search, freshCookie);
  const secondPage = await report(search + '&page=2', freshCookie);
  assert.deepEqual(firstPage.pagination, {page: 1, pageSize: 25, total: 26});
  assert.deepEqual(secondPage.pagination, {page: 2, pageSize: 25, total: 26});
  const results = [...firstPage.bookings, ...secondPage.bookings];
  assert.equal(results.length, 26);
  assert.equal(new Set(results.map(row => row.reference)).size, 26);
  assert.ok(results.every(row => row.email.startsWith('sample.')));
  assert.equal(secondPage.stats.confirmedBookings, 27);
  assert.equal((await report(firstDay + '&email=sample.', freshCookie)).pagination.total, 0);
  assert.equal((await report('?email=%25', freshCookie)).pagination.total, 0);
  assert.equal((await request('/api/admin/bookings?page=0', undefined, freshCookie)).status, 400);
  assert.equal((await request('/api/admin/bookings?email=a&email=b', undefined, freshCookie)).status, 400);

  const matchingCsv = await (await request('/api/admin/report.csv' + search, undefined, freshCookie)).text();
  assert.ok(results.every(row => matchingCsv.includes(row.reference)));
  assert.ok(!matchingCsv.includes(winner));
  assert.equal((await remove(secondPage.bookings[0].reference)).status, 200);
  const afterLastPageDeletion = await report(search + '&page=2', freshCookie);
  assert.deepEqual(afterLastPageDeletion.pagination, {page: 1, pageSize: 25, total: 25});
});

test('appointments must be booked at least 24 hours ahead in Cairo time', () => {
  // 24 Nov 2026 09:00 Cairo is 07:00 UTC; the clock is 23 Nov 08:00 UTC, so 09:00-09:45 are under 24 hours away.
  const store = openStore(':memory:', {now: () => Date.parse('2026-11-23T08:00:00Z')});
  try {
    const {slots} = store.availability('employee@afreximbank.com');
    const at = time => slots.find(slot => slot.date === '2026-11-24' && slot.room === 'Meeting Room 9' && slot.time === time);
    assert.equal(at('09:45').available, false);
    assert.equal(at('10:00').available, true);
    assert.throws(() => store.book({email: 'employee@afreximbank.com', name: 'Mona Hassan', phone: '+201000000001', slotId: at('09:45').id}), /24 hours in advance/);
    assert.equal(store.book({email: 'employee@afreximbank.com', name: 'Mona Hassan', phone: '+201000000001', slotId: at('10:00').id}).canCancel, true);
  } finally {
    store.close();
  }
});

test('bookings made before names were collected survive the upgrade', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'egybell-migrate-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const databasePath = join(dir, 'bookings.sqlite');
  const old = new DatabaseSync(databasePath);
  old.exec(`
    CREATE TABLE slots (id TEXT PRIMARY KEY, date TEXT NOT NULL, room TEXT NOT NULL, time TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0, 1))) STRICT;
    CREATE TABLE bookings (reference TEXT PRIMARY KEY, slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
      email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, room TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    INSERT INTO slots VALUES ('${'a'.repeat(64)}', '2026-11-24', 'Room 1', '09:00', 1);
    INSERT INTO bookings VALUES ('AB12CD34', '${'a'.repeat(64)}', 'old@afreximbank.com', '+201000000001', 'Room 1', '2026-11-01T00:00:00Z');
  `);
  old.close();
  const store = openStore(databasePath, {now: () => Date.parse('2026-11-01T00:00:00Z')});
  try {
    const [row] = store.bookings();
    assert.equal(row.reference, 'AB12CD34');
    assert.equal(row.name, '');
    const {slots} = store.availability('new@afreximbank.com');
    const open = slots.find(slot => slot.available);
    assert.equal(store.book({email: 'new@afreximbank.com', name: '  مني   أحمد ', phone: '+201000000002', slotId: open.id}).name, 'مني أحمد');
  } finally {
    store.close();
  }
});
