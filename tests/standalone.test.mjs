import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {once} from 'node:events';
import {createBookingApp} from '../server/app.mjs';

test('booking and HR management share a durable database', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'egybell-test-'));
  const databasePath = join(dir, 'bookings.sqlite');
  const adminPassword = 'test-only-password-123';
  t.after(() => rm(dir, {recursive: true, force: true}));

  async function start() {
    const {app, close} = createBookingApp({databasePath, adminPassword});
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
  assert.equal((await request('/api/admin/login', {password: 'wrong'})).status, 401);
  const login = await request('/api/admin/login', {password: adminPassword});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const slots = (await (await publicApi({action: 'availability', email})).json()).slots;
  assert.equal(slots.length, 128);
  const before = await (await publicApi({action: 'availability', email})).json();
  assert.equal(before.booking, undefined);
  const slotId = slots[0].id;
  const booking = {action: 'book', email, phone: '+201000000001', slotId};
  const concurrent = await Promise.all([publicApi(booking), publicApi({...booking, email: 'another@afreximbank.com'})]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const winner = (await (await publicApi({action: 'availability', email})).json()).hasBooking ? email : 'another@afreximbank.com';
  const receipt = await (await publicApi({...booking, email: winner})).json();
  assert.match(receipt.id, /^[0-9A-F]{8}$/);
  // Without Clerk the email is self-reported, so booking details must not be returned.
  assert.equal((await (await publicApi({action: 'availability', email: winner})).json()).booking, undefined);
  assert.equal((await publicApi({...booking, email: winner, slotId: slots[1].id})).status, 409);

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
  assert.ok(!(await (await request('/api/admin/report.csv', undefined, freshCookie)).text()).includes(receipt.id));
  const afterDelete = await (await publicApi({action: 'availability', email: winner})).json();
  assert.equal(afterDelete.hasBooking, false);
  const openSlot = afterDelete.slots.find(slot => slot.available);
  const rebooked = await publicApi({action: 'book', email: winner, phone: '+201000000001', slotId: openSlot.id});
  assert.equal(rebooked.status, 200);
  assert.deepEqual((await (await publicApi({action: 'schedule'})).json()).dates, ['2026-11-24', '2026-11-25', '2026-11-26']);
});
