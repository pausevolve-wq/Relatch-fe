// V3 entry. `../analytics` is the real GTM/PostHog bootstrap in production; in the sandbox it is
// aliased to the stub that also installs the mock backend and the dev toolbar.
import '../analytics';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import './v3.css';
import V3App from './V3App';
import { clerkAppearance } from './clerkAppearance';
import { AppErrorBoundary } from './ErrorScreens';
import { SsoCallback } from './auth/SsoCallback';
import { V3_BASE } from './base';

// Google and GitHub send people back to /sso-callback (Clerk's redirectCallbackUrl, see auth/clerkAuth.ts)
const isSsoCallback = /\/sso-callback\/?$/.test(window.location.pathname);

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPubKey) throw new Error('Missing Clerk Publishable Key');

document.documentElement.classList.add('dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside Clerk too: a failure anywhere while drawing shows the crash screen, never a blank page */}
    <AppErrorBoundary>
      {/* afterSignOutUrl = V3's own address (base.ts), so signing out at /v3 doesn't land on the old app */}
      <ClerkProvider publishableKey={clerkPubKey} afterSignOutUrl={V3_BASE} appearance={clerkAppearance}>
        {isSsoCallback ? <SsoCallback /> : <V3App />}
      </ClerkProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
