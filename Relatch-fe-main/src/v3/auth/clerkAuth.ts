// The real AuthApi: clerkAuthCore.ts on Clerk's signal hooks. The sandbox swaps this file for sandboxAuth.ts
// through authApi.ts (vite.sandbox.config.ts aliases it), so the prototype keeps its fake auth.
import { useMemo, useRef } from 'react';
import { useSignIn, useSignUp } from '@clerk/react';
import type { AuthApi } from './AuthSheet';
import { createClerkAuth, type SignInLike, type SignUpLike } from './clerkAuthCore';
import { appPath } from '../base';

/** Where V3 lives (base.ts: "/v3/" while it is tested on production, "/" after the flip) */
export function appUrls() {
  return { appUrl: new URL(appPath(), window.location.origin).href, callbackUrl: new URL(appPath('sso-callback'), window.location.origin).href };
}

export function useAuthApi(): AuthApi {
  const { signUp } = useSignUp();
  const { signIn } = useSignIn();
  // The assignments are the type check: Clerk's real resources must fit the narrow shapes the core uses
  const live = useRef<{ signUp: SignUpLike; signIn: SignInLike }>({ signUp, signIn });
  live.current = { signUp, signIn };
  return useMemo(() => createClerkAuth(() => live.current, appUrls()), []);
}
