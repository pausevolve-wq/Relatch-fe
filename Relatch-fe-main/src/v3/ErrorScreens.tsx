// V3's error screens (Manas, 2026-11-09: "build the new 404 error page according to the new UI design for our
// app in case the user faces any error"). Two cases, one look:
//   NotFound     - an address the app doesn't have. V3 has no routes of its own (every screen is app state)
//                  and Vercel rewrites every path to index.html, so without this a mistyped or old link just
//                  opened the app as if nothing were wrong. Still a soft 404 (the server answers 200), so the
//                  page marks itself noindex.
//   CrashScreen  - the app itself failed while drawing (AppErrorBoundary, round the whole app in main.tsx).
//                  It leans on nothing that may be what broke: no Clerk, no app state, no canvas background.
// The Relatch mark is the character, as on the sign-up sheet (MarkBuddy): on the 404 it is the "0", looking
// round for the page; on a crash it doubts, with one shake as it lands. Motion is the app's own: the digits
// pop like ComingSoon's orbit, the headline reveals word by word like the home hero (SplitText), the rest
// resolves out of a blur. Reduced motion: everything is simply there.
import { Component, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { gsap } from 'gsap';
import SplitText from '@/components/SplitText';
import { MarkBuddy } from './auth/MarkBuddy';
import { CONTACT_EMAIL } from './ContactPage';
import { captureEvent } from '../analytics';
import { cn } from '@/lib/utils';
import { V3_BASE, pathInApp } from './base';

const ring = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';
const primary = cn('inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-[14.5px] font-medium text-black transition-[background-color,transform] duration-200 hover:bg-white/90 active:scale-[0.98]', ring);
const secondary = cn('inline-flex h-11 items-center justify-center rounded-full border border-line-2 px-6 text-[14.5px] text-fg transition-colors hover:bg-white/[0.06]', ring);

// ---- Which addresses are the app ---------------------------------------------------------------------------
// Everything else is a 404. AT THE PORT: add every real path the app serves, above all the OAuth return page
// (sandboxAuth.ts: "V3 needs an SSO callback page for the return"), or Google/GitHub sign-in lands on the 404.
const APP_PATHS = ['/', '/index.html', '/sso-callback'];
// The sandbox and the claude.ai artifact run at addresses of their own (/v3.html, /artifact.html, the artifact
// frame), so there a wrong address is simulated: the sandbox bar's "Open a wrong address" stores one.
const SANDBOX = !!import.meta.env.VITE_SANDBOX;
const SBX_PATH = 'sbx_path';

/** The address being shown, when it isn't one of the app's; null when it is */
export function strayPath(): string | null {
  let path = '/';
  if (SANDBOX) { try { path = sessionStorage.getItem(SBX_PATH) ?? '/'; } catch { /* storage refused: the app */ } }
  else path = window.location.pathname;
  // 2026-11-15: judged relative to where V3 is served (base.ts), so /v3 and /v3/sso-callback are the app
  // while V3 is tested at /v3; anything outside that base is not V3's
  const inApp = SANDBOX ? path : pathInApp(path);
  if (inApp === null) return path;
  const clean = inApp.length > 1 ? inApp.replace(/\/+$/, '') : inApp;
  return APP_PATHS.includes(clean) ? null : path;
}

/** Back to the app's own address, without a reload (the app is already loaded and keeps its state) */
export function leaveStrayPath() {
  if (SANDBOX) { try { sessionStorage.removeItem(SBX_PATH); } catch { /* nothing to undo */ } }
  else window.history.replaceState(null, '', V3_BASE);
}

// ---- The shared layout --------------------------------------------------------------------------------------
/** The arrival: pieces marked data-pop spring in one after another, data-in lines resolve out of a blur */
function useArrival(root: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const q = gsap.utils.selector(el);
    const ctx = gsap.context(() => {
      gsap.from(q('[data-pop]'), { opacity: 0, y: 18, scale: 0.7, filter: 'blur(8px)', duration: 0.75, ease: 'back.out(1.7)', stagger: 0.09, clearProps: 'filter' });
      gsap.from(q('[data-in]'), { opacity: 0, y: 8, filter: 'blur(6px)', duration: 0.55, ease: 'expo.out', stagger: 0.14, delay: 0.55, clearProps: 'filter' });
      gsap.to(q('[data-glow]'), { opacity: 0.85, scale: 1.08, duration: 2.8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }, el);
    return () => ctx.revert();
  }, [root]);
}

/** The page's title, and noindex while it shows (a soft 404 must not be indexed as a real page) */
function usePageMeta(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    return () => { document.title = before; robots.remove(); };
  }, [title]);
}

function Screen({ art, title, body, children }: { art: ReactNode; title: string; body: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useArrival(root);
  return (
    <main ref={root} className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-ink px-4 py-16 text-center text-fg sm:px-6" style={{ paddingTop: 'max(4rem, env(safe-area-inset-top))', paddingBottom: 'max(4rem, env(safe-area-inset-bottom))' }}>
      {/* A soft light behind the art, breathing slowly; plain CSS, so it works even when the app can't */}
      <div aria-hidden="true" data-glow className="pointer-events-none absolute left-1/2 top-[38%] size-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.045] opacity-60 blur-3xl" />
      <div className="relative flex w-full max-w-[560px] flex-col items-center">
        {art}
        <SplitText
          tag="h1"
          text={title}
          // SplitText clips to its box (overflow: hidden, for the words' rise), and at this line height the
          // descenders (the "g" of "page") hung 2.3px below it. pb lets them show; -mb keeps the spacing below.
          className="mt-9 -mb-[0.15em] pb-[0.15em] text-[clamp(26px,4.2vw,36px)] font-semibold leading-[1.12] tracking-[-0.035em] text-fg"
          splitType="words"
          delay={60}
          duration={1}
          ease="expo.out"
          from={{ opacity: 0, y: 22, filter: 'blur(10px)' }}
          to={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          threshold={0}
          rootMargin="0px"
        />
        {/* w-full: as a centred flex item it would size to its widest line (a long address) and spill off a phone */}
        <div data-in className="mt-3 w-full max-w-[46ch] text-balance text-[15.5px] leading-relaxed text-fg-2">{body}</div>
        <div data-in className="mt-8 flex w-full flex-col-reverse gap-2.5 sm:w-auto sm:flex-row sm:justify-center">{children}</div>
      </div>
    </main>
  );
}

// ---- 404 ----------------------------------------------------------------------------------------------------
export function NotFound({ path, onHome, onContact }: { path: string; onHome: () => void; onContact: () => void }) {
  usePageMeta('Page not found · Relatch');
  // One hop as the mark lands in the middle of the number; after that it just looks round (MarkBuddy idle)
  const [hops, setHops] = useState(0);
  useEffect(() => {
    captureEvent('page_not_found', { path });
    const timer = window.setTimeout(() => setHops(1), 650);
    return () => window.clearTimeout(timer);
  }, [path]);
  // No tracking: each "4" is one glyph, so letter-spacing only added a trailing -0.06em that pulled the
  // mark toward the first 4 (ink gaps measured 21.8px left vs 34.6px right at 176px). The first 4's
  // 0.0125em margin evens out what is left: the glyph's own side bearings and where the mark sits in its box.
  const digit = 'text-[clamp(104px,24vw,176px)] font-semibold leading-none text-fg';
  return (
    <Screen
      art={
        // Read as one word by screen readers; the mark is decoration standing in for the "0"
        <div role="img" aria-label="404" className="flex items-center gap-[clamp(6px,1.4vw,14px)]">
          <span data-pop aria-hidden className={cn(digit, 'mr-[0.0125em]')}>4</span>
          <span data-pop aria-hidden className="block"><MarkBuddy size={0} hops={hops} className="size-[clamp(84px,19vw,140px)]" /></span>
          <span data-pop aria-hidden className={digit}>4</span>
        </div>
      }
      title="This page wandered off"
      body={
        <>
          <p>The link may be old or mistyped. Your skills are right where you left them.</p>
          <p className="mx-auto mt-4 w-fit max-w-full truncate rounded-full bg-white/[0.04] px-3.5 py-1.5 font-mono text-[12.5px] text-fg-3 ring-1 ring-line" title={path}>
            {(SANDBOX ? 'app.relatch.online' : window.location.host) + path}
          </p>
        </>
      }
    >
      <button type="button" onClick={onContact} className={secondary}>Contact us</button>
      <button type="button" onClick={onHome} className={primary}>Go to Relatch</button>
    </Screen>
  );
}

// ---- Crash --------------------------------------------------------------------------------------------------
export function CrashScreen({ error }: { error: Error }) {
  usePageMeta('Something went wrong · Relatch');
  const [shakes, setShakes] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setShakes(1), 700);
    return () => window.clearTimeout(timer);
  }, []);
  // The details go into the email for support, never onto the screen
  const mail = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Relatch stopped working')}&body=${encodeURIComponent(
    `What were you doing when it happened?\n\n\n---\nError: ${error.message.slice(0, 300)}\nTime: ${new Date().toISOString()}\nPage: ${window.location.href}\nBrowser: ${navigator.userAgent}`,
  )}`;
  return (
    <Screen
      art={<span data-pop className="block"><MarkBuddy size={0} mood="doubt" shakes={shakes} className="size-[clamp(96px,22vw,132px)]" /></span>}
      title="Something broke on our side"
      body={<p>Relatch hit an error and had to stop. Reloading usually fixes it. Your saved skills are safe.</p>}
    >
      <a href={mail} className={secondary}>Email us</a>
      <button type="button" onClick={() => window.location.reload()} className={primary}>Reload</button>
    </Screen>
  );
}

/** Round the whole app: a failure while drawing shows CrashScreen instead of a blank page */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Relatch crashed:', error, info.componentStack);
    try { captureEvent('app_crash', { message: error.message.slice(0, 300), path: window.location.pathname }); } catch { /* analytics may be what broke */ }
  }
  render() {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children;
  }
}
