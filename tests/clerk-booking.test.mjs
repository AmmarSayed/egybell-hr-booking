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
  const {app, close} = createBookingApp({databasePath: ':memory:', adminPassword: 'test-only-password-123', bookingAuth});
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
  assert.equal((await api('book', null, {email, slotId, phone: '+201000000001'})).status, 401);
  const booking = await api('book', 'employee', {email: 'different@afreximbank.com', slotId, phone: '+201000000001'});
  assert.equal(booking.status, 200);
  assert.equal((await (await api('availability', 'employee')).json()).hasBooking, true);
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
