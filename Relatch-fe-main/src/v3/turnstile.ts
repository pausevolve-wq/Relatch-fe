// Cloudflare Turnstile before the free try's token is minted (2026-11-17). The backend (claudly-proxy
// api/anon-token.js, relatch#49) asks for it only once TURNSTILE_SECRET_KEY is set there; it reads
// `turnstile` from the JSON body. Widget "Relatch free trial", Managed mode, hostname app.relatch.online:
// most people pass without seeing anything; a suspicious visitor gets one checkbox, shown at the bottom of
// the screen only then (appearance 'interaction-only').
//
// No VITE_TURNSTILE_SITE_KEY in this build (local, sandbox): no widget, an empty token, and the backend
// ignores it while its secret is unset. ORDER when switching on: this build live first, THEN the backend
// secret. The other way round, every free try is refused (TURNSTILE_REQUIRED).
//
// Clerk's sign-up loads the same Cloudflare script for its own captcha. Ours is the same URL, loaded once,
// and reused if Clerk already put `window.turnstile` there, so the page never holds two copies.
// If the script can't load (an ad blocker, Cloudflare down), the check stalls, or nobody answers the checkbox,
// the token is empty: the mint is then refused and the person is asked to sign up, the same as a spent free try.

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || '';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// A pass without a checkbox takes about 2 s (measured 2026-11-17), so 15 s is a stall, not a slow pass: the try
// goes on (refused -> sign-up) instead of a silent wait. Only when Cloudflare shows the checkbox
// (before-interactive) does the wait stretch, long enough to notice and tick it.
const WAIT_MS = 15_000;
const WAIT_INTERACTIVE_MS = 60_000;

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile | null> | null = null;

function loadTurnstile(): Promise<Turnstile | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<Turnstile | null>((resolve) => {
    // Clerk may be loading it right now: wait for that copy instead of adding a second
    const existing = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
    const s = existing ?? Object.assign(document.createElement('script'), { src: SCRIPT_URL, async: true });
    const done = () => resolve(window.turnstile ?? null);
    s.addEventListener('load', done, { once: true });
    s.addEventListener('error', () => resolve(null), { once: true });
    if (!existing) document.head.appendChild(s);
    window.setTimeout(done, 15_000); // a script that never settles still lets the try go on (refused, not stuck)
  }).then((t) => { if (!t) loading = null; return t; }); // a failed load may be retried on the next try
  return loading;
}

/** A fresh Turnstile token for one mint, or '' (no site key, script blocked, or not answered in time) */
export async function turnstileToken(): Promise<string> {
  if (!SITE_KEY) return '';
  const ts = await loadTurnstile();
  if (!ts) return '';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000';
  document.body.appendChild(box);
  return new Promise<string>((resolve) => {
    let id: string | undefined;
    let settled = false;
    const finish = (token: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { if (id) ts.remove(id); } catch { /* already gone */ }
      box.remove();
      resolve(token);
    };
    let timer = window.setTimeout(() => finish(''), WAIT_MS);
    try {
      id = ts.render(box, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        action: 'anon-trial',
        theme: 'dark',
        // One attempt per mint: Cloudflare's own retry would reset a widget we may already have removed
        // (an uncaught "Nothing to reset" error, seen 2026-11-17). A failed try is simply refused instead.
        retry: 'never',
        'refresh-expired': 'never',
        'before-interactive-callback': () => { window.clearTimeout(timer); timer = window.setTimeout(() => finish(''), WAIT_INTERACTIVE_MS); },
        callback: (token: string) => finish(typeof token === 'string' ? token : ''),
        'error-callback': () => { finish(''); return true; }, // handled: no console error from Cloudflare
        'expired-callback': () => finish(''),
        'timeout-callback': () => finish(''),
      }) ?? undefined;
    } catch {
      finish('');
    }
  });
}
