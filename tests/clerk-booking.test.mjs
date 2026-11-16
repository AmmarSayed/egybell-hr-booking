import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {createBookingApp} from '../server/app.mjs';
import {createClerkBookingAuth} from '../server/clerk-booking.mjs';

const origin = 'https://booking.example.com';
const publishableKey = 'pk_test_' + Buffer.from('booking.accounts.dev$').toString('base64');
const secretKey = 'sk_test_example';

test('Clerk booking verifies the session and uses the verified work email', async t => {
  const users = {
    'wrong-origin': {emailAddress: 'employee@afreximbank.com', verification: {status: 'verified'}},
    employee: {emailAddress: 'Employee@afreximbank.com', verification: {status: 'verified'}},
    unverified: {emailAddress: 'employee@afreximbank.com', verification: {status: 'unverified'}},
    external: {emailAddress: 'employee@example.com', verification: {status: 'verified'}},
    test: {emailAddress: 'employee+clerk_test@afreximbank.com', verification: {status: 'verified'}},
  };
  const clerkClient = {
    async authenticateRequest(request, options) {
      assert.equal(new URL(request.url).origin, origin);
      assert.deepEqual(options.authorizedParties, [origin]);
      assert.equal(options.acceptsToken, 'session_token');
      const userId = request.headers.get('authorization')?.slice(7);
      return {isAuthenticated: Object.hasOwn(users, userId), toAuth: () => ({userId, sessionClaims: {azp: userId === 'wrong-origin' ? 'https://other.example.com' : origin}})};
    },
    users: {
      async getUser(userId) {
        return {primaryEmailAddressId: 'primary', emailAddresses: [{id: 'primary', ...users[userId]}]};
      },
    },
  };
  const bookingAuth = createClerkBookingAuth({publishableKey, secretKey, origin, clerkClient});
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const {app, close} = createBookingApp({databasePath: ':memory:', adminPassword: 'test-only-password-123', bookingAuth, now: () => clock});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    close();
  });

  const base = 'http://127.0.0.1:' + server.address().port + '/api/';
  const api = (action, token, body = {}) => fetch(base + 'booking', {
    method: 'POST',
    headers: {'content-type': 'application/json', ...(token && {authorization: 'Bearer ' + token})},
    body: JSON.stringify({action, ...body}),
  });
  const config = await (await fetch(base + 'booking-auth')).json();
  assert.deepEqual(config, {publishableKey});
  assert.equal((await api('schedule')).status, 200);
  assert.equal((await api('availability', null, {email: 'employee@afreximbank.com'})).status, 401);
  assert.equal((await api('book', 'invalid')).status, 401);
  assert.equal((await api('availability', 'wrong-origin')).status, 401);
  for (const user of ['external', 'unverified', 'test']) {
    assert.equal((await api('availability', user)).status, 403);
  }

  const availability = await api('availability', 'employee', {email: 'different@afreximbank.com'});
  assert.equal(availability.status, 200);
  const {email, slots} = await availability.json();
  assert.equal(email, 'employee@afreximbank.com');
  const slotId = slots[0].id;
  assert.equal((await api('book', null, {email, slotId, name: 'Mona Hassan', phone: '+201000000001'})).status, 401);
  const booking = await api('book', 'employee', {email: 'different@afreximbank.com', slotId, name: 'Mona Hassan', phone: '+201000000001'});
  assert.equal(booking.status, 200);
  const existing = await (await api('availability', 'employee')).json();
  assert.equal(existing.hasBooking, true);
  assert.equal(existing.booking.id, (await booking.json()).id);
  assert.equal(existing.booking.details.date, slots[0].date);
  assert.equal(existing.booking.details.room, slots[0].room);
  assert.equal(existing.booking.phone, undefined);
  assert.equal(existing.booking.canCancel, true);
  assert.equal(existing.booking.name, 'Mona Hassan');

  // Cancelling more than 24 hours ahead frees the slot so the employee can choose again.
  assert.equal((await api('cancel', null)).status, 401);
  const cancelled = await api('cancel', 'employee');
  assert.equal(cancelled.status, 200);
  assert.equal((await api('cancel', 'employee')).status, 404);
  const afterCancel = await (await api('availability', 'employee')).json();
  assert.equal(afterCancel.hasBooking, false);
  assert.equal(afterCancel.slots.find(slot => slot.id === slotId).available, true);
  const rebooked = await api('book', 'employee', {slotId, name: 'Mona Hassan', phone: '+201000000001'});
  assert.equal(rebooked.status, 200);
  assert.notEqual((await rebooked.json()).id, existing.booking.id);

  // slots[0] is 24 Nov 09:00 Cairo (07:00 UTC). From 23 Nov 08:00 UTC it is 23 hours away.
  assert.equal(slots[0].date + ' ' + slots[0].time, '2026-11-24 09:00');
  clock = Date.parse('2026-11-23T08:00:00Z');
  const late = await (await api('availability', 'employee')).json();
  assert.equal(late.booking.canCancel, false);
  const cancelLate = await api('cancel', 'employee');
  assert.equal(cancelLate.status, 409);
  assert.match((await cancelLate.json()).error, /24 hours/);
  // 10:00 Cairo on 24 Nov is exactly 24 hours away: earlier slots close, later ones stay open.
  const onThe24th = late.slots.filter(slot => slot.date === '2026-11-24' && slot.id !== slotId);
  assert.ok(onThe24th.filter(slot => slot.time < '10:00').every(slot => !slot.available));
  assert.ok(onThe24th.filter(slot => slot.time >= '10:00').every(slot => slot.available));
  assert.equal((await api('cancel', 'employee')).status, 409);

  assert.equal((await fetch(base + 'admin/cancellations', {headers: {authorization: 'Bearer employee'}})).status, 401);
  const adminLogin = await fetch(base + 'admin/login', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({password: 'test-only-password-123'}),
  });
  const cookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const history = query => fetch(base + 'admin/cancellations' + query, {headers: {cookie}});
  const result = await history('?email=EMPLOYEE&from=2026-11-24&to=2026-11-24');
  assert.equal(result.status, 200);
  const recorded = {
    bookings: [{
      reference: existing.booking.id, name: 'Mona Hassan', email,
      date: slots[0].date, time: slots[0].time, room: slots[0].room,
      cancelledAt: '2026-11-01T00:00:00.000Z',
    }],
    pagination: {page: 1, pageSize: 25, total: 1},
  };
  assert.deepEqual(await result.json(), recorded);
  assert.equal((await (await history('?email=someone-else')).json()).pagination.total, 0);
  const schedule = await (await fetch(base + 'admin/schedule', {headers: {cookie}})).json();
  const update = await fetch(base + 'admin/schedule', {
    method: 'POST',
    headers: {'content-type': 'application/json', cookie},
    body: JSON.stringify({windows: [], revision: schedule.revision}),
  });
  assert.equal(update.status, 200);
  assert.deepEqual(await (await history('')).json(), recorded);
});

test('the live service requires Clerk and warns about development keys', () => {
  assert.equal(createClerkBookingAuth({}), null);
  assert.throws(() => createClerkBookingAuth({secure: true}), /must sign in/);
  assert.throws(() => createClerkBookingAuth({publishableKey, origin}), /together/);
  const warnings = [];
  const auth = createClerkBookingAuth({publishableKey, secretKey, origin, secure: true, log: {warn: message => warnings.push(message)}});
  assert.equal(auth.publishableKey, publishableKey);
  assert.match(warnings[0], /development keys/);
});
