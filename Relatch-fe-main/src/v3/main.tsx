// V3 entry. `../analytics` is the real GTM/PostHog bootstrap in production; in the sandbox it is
// aliased to the stub that also installs the mock backend and the dev toolbar.
import { captureEvent } from '../analytics';
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

// 2026-11-28 (blank-page report). Google Fonts, added from here rather than v3.html: a stylesheet in the page's
// <head> blocks the app's script and all painting until it arrives, so a hung fonts.googleapis.com meant a black
// page that never loaded (reproduced with the request held open). Added by script, it blocks nothing. It only
// carries Geist Mono (skill previews) and Kalam (the feedback note), neither on the first screen; Satoshi, the
// app's own face, is self-hosted in v3.css.
const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400;500&family=Kalam:wght@400;700&display=swap';
document.head.appendChild(fonts);

// Our own stylesheet failed to arrive (a cloud browser saw the app unstyled, 2026-11-27): this script only runs
// once the browser is done with it, so a sheet without rules means it failed (Chrome still makes a sheet for a
// failed link; reading its rules throws). Fetch it once more.
const css = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="/assets/"]');
const cssLoaded = (() => { try { return !!css?.sheet && css.sheet.cssRules.length > 0; } catch { return false; } })();
if (css && !cssLoaded) {
  const again = css.cloneNode() as HTMLLinkElement;
  again.href = `${css.href}?retry=1`;
  css.after(again);
  captureEvent('boot_css_retry', {});
}

// public/boot-watch.js reloaded this tab once because nothing had drawn: say so, or a real person's blank page
// leaves no trace anywhere ('reported' still stops the watchdog reloading again in this tab)
try {
  if (sessionStorage.getItem('relatch_boot_retry') === '1') { sessionStorage.setItem('relatch_boot_retry', 'reported'); captureEvent('boot_retried', {}); }
} catch { /* storage blocked */ }

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
