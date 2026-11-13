import {createClerkClient} from '@clerk/backend';
import {RequestError, workEmail} from './store.mjs';

export function createClerkBookingAuth({publishableKey, secretKey, origin, secure = false, clerkClient, log = console}) {
  if (!publishableKey && !secretKey) {
    if (secure) throw new Error('Set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY so employees must sign in before booking.');
    return null;
  }
  if (!publishableKey || !secretKey) {
    throw new Error('Set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY together.');
  }
  const keyMode = publishableKey.startsWith('pk_live_') ? 'live' : 'test';
  if (!publishableKey.startsWith('pk_' + keyMode + '_') || !secretKey.startsWith('sk_' + keyMode + '_')) {
    throw new Error('Use matching Clerk publishable and secret key types.');
  }
  if (secure && keyMode !== 'live') {
    log.warn('Clerk development keys are in use: sign-in shows a development badge and is limited to 100 users.');
  }
  const url = origin && URL.canParse(origin) ? new URL(origin) : null;
  if (!url || origin !== url.origin || (secure ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol))) {
    throw new Error('Set BOOKING_ORIGIN to the booking site origin, without a trailing slash.');
  }
  const client = clerkClient ?? createClerkClient({publishableKey, secretKey});

  return {
    publishableKey,
    async verifiedEmail(authorization) {
      const signInError = 'Sign in with your work email to continue.';
      if (!authorization?.startsWith('Bearer ')) throw new RequestError(401, signInError);
      const request = new Request(new URL('/api/booking', origin), {
        method: 'POST',
        headers: {authorization},
      });
      const state = await client.authenticateRequest(request, {authorizedParties: [origin], acceptsToken: 'session_token'});
      const auth = state.toAuth();
      if (!state.isAuthenticated || !auth?.userId || auth.isAuthenticated === false || auth.sessionClaims?.azp !== origin) {
        throw new RequestError(401, signInError);
      }

      const user = await client.users.getUser(auth.userId);
      const primary = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId);
      if (primary?.verification?.status !== 'verified') {
        throw new RequestError(403, 'Verify your work email in your Clerk account to continue.');
      }
      try {
        const email = workEmail(primary.emailAddress);
        if (email.split('@')[0].includes('+clerk_test')) throw new Error();
        return email;
      } catch {
        throw new RequestError(403, 'Set a verified @afreximbank.com address as your primary email to continue.');
      }
    },
  };
}
