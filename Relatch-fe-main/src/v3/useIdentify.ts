// Clerk -> PostHog identify, ported 2026-11-15 from production App.tsx (the "identify wiring" merged 2026-08-13)
// so V3 does not bring back the blank-demographics bug: without it every signed-in V3 user is anonymous in
// PostHog. Same properties and the same event as production. prevSignedIn tells a real sign-in (false -> true)
// apart from a page load with a session already there, so clerk_signin_success fires only on a real sign-in.
//
// 2026-11-19 (PostHog rebuild):
// - A Google or GitHub sign-in comes back with a full page load (SsoCallback: location.replace), so isSignedIn
//   goes undefined -> true and the false -> true test above never passed: no OAuth sign-in or sign-up was ever
//   recorded. The auth sheet now notes what it started (analytics.ts, noteAuthIntent), and that note counts too.
// - A new account (created in the last 15 minutes) also sends user_signed_up, with how and from where
//   (via: 'unlock' = signed up to unlock a free-try skill). clerk_signin_success carries kind: signup | login.
// - Person properties for the demographics view: email domain (work address or not), auth method, how they
//   first signed up. GeoIP, device, browser and referrer come from PostHog itself.
// - Signing out resets PostHog, so the next person on a shared browser is not merged into this account.
import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/react';
import { captureEvent, identifyUser, resetAnalytics, takeAuthIntent } from '../analytics';
import { readStorage } from '@/engine/core';

const NEW_ACCOUNT_MS = 15 * 60 * 1000;

export function useIdentify() {
  const { isSignedIn, user } = useUser();
  const prevSignedIn = useRef(isSignedIn);
  // This signed-in stretch has been looked at once (the user object reloads often; one sign-in counts once)
  const counted = useRef(false);
  useEffect(() => {
    if (isSignedIn && user) {
      const email = user.primaryEmailAddress?.emailAddress;
      const provider = user.externalAccounts?.[0]?.provider?.replace('oauth_', '');
      identifyUser(user.id, {
        email,
        name: user.fullName,
        username: user.username,
        clerk_created_at: user.createdAt,
        email_domain: email?.split('@')[1]?.toLowerCase(),
        auth_method: provider || 'email',
      });
      if (!counted.current) {
        counted.current = true;
        const intent = takeAuthIntent();
        if (prevSignedIn.current === false || intent) {
          const method = intent?.method || provider || 'email';
          const isNew = !!user.createdAt && Date.now() - new Date(user.createdAt).getTime() < NEW_ACCOUNT_MS;
          const via = intent?.via ?? 'direct';
          const props = { method, kind: isNew ? 'signup' : 'login', via, unlock_action: intent?.action };
          if (isNew) identifyUser(user.id, {}, { signed_up_via: via, signed_up_method: method, signed_up_at: new Date().toISOString() });
          captureEvent('clerk_signin_success', {
            ...props,
            user_agent: navigator.userAgent,
            referrer: document.referrer,
            session_id: readStorage('rl_session_id'),
          });
          if (isNew) captureEvent('user_signed_up', props);
          // The sheet sends this itself for email sign-ins; a Google / GitHub one left the page before it could
          if (via === 'unlock' && (method === 'google' || method === 'github')) captureEvent('unlock_auth_success', { action: intent?.action, mode: isNew ? 'signup' : 'login', method });
        }
      }
    } else if (isSignedIn === false) {
      if (prevSignedIn.current === true) resetAnalytics();
      counted.current = false;
    }
    prevSignedIn.current = isSignedIn;
  }, [isSignedIn, user]);
}
