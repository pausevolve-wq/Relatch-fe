// Clerk -> PostHog identify, ported 2026-11-15 from production App.tsx (the "identify wiring" merged 2026-08-13)
// so V3 does not bring back the blank-demographics bug: without it every signed-in V3 user is anonymous in
// PostHog. Same properties and the same event as production. prevSignedIn tells a real sign-in (false -> true)
// apart from a page load with a session already there, so clerk_signin_success fires only on a real sign-in.
import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/react';
import { captureEvent, identifyUser } from '../analytics';
import { readStorage } from '@/engine/core';

export function useIdentify() {
  const { isSignedIn, user } = useUser();
  const prevSignedIn = useRef(isSignedIn);
  useEffect(() => {
    if (isSignedIn && user) {
      identifyUser(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName,
        username: user.username,
        clerk_created_at: user.createdAt,
      });
      if (prevSignedIn.current === false) {
        captureEvent('clerk_signin_success', {
          method: user.externalAccounts?.[0]?.provider?.replace('oauth_', '') || 'email',
          user_agent: navigator.userAgent,
          referrer: document.referrer,
          session_id: readStorage('rl_session_id'),
        });
      }
    }
    prevSignedIn.current = isSignedIn;
  }, [isSignedIn, user]);
}
