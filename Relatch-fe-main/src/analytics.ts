// Analytics bootstrap — moved out of index.html to allow CSP without 'unsafe-inline' in script-src.
// Imported from src/main.tsx before React mounts so page-load attribution timing is preserved.

// 2026-11-20: Google Tag Manager (GTM-P5K7B3C5) and Google Analytics 4 (G-3S6Z146BBL) removed (Manas: neither is
// used for analytics; PostHog is). GTM's only tag was Microsoft Clarity, which the CSP blocks, so it did nothing but
// log a CSP error on every page load. Search Console is verified by DNS, not by either tag. Their hosts left the CSP.

// ─── PostHog ──────────────────────────────────────────────────────────────────
!(function (t: any, e: any) {
  let o: any, n: any, p: any, r: any;
  if (!e.__SV) {
    (window as any).posthog = e;
    e._i = [];
    e.init = function (i: any, s: any, a: any) {
      function g(t: any, e: any) {
        const o = e.split('.');
        if (o.length === 2) {
          t = t[o[0]];
          e = o[1];
        }
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      }
      p = t.createElement('script');
      p.type = 'text/javascript';
      p.crossOrigin = 'anonymous';
      p.async = true;
      p.src =
        s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') +
        '/static/array.js';
      r = t.getElementsByTagName('script')[0];
      r.parentNode.insertBefore(p, r);
      let u = e;
      if (typeof a !== 'undefined') {
        u = e[a] = [];
      } else {
        a = 'posthog';
      }
      u.people = u.people || [];
      u.toString = function (t: any) {
        let e = 'posthog';
        if (a !== 'posthog') e += '.' + a;
        if (!t) e += ' (stub)';
        return e;
      };
      u.people.toString = function () {
        return u.toString(1) + '.people (stub)';
      };
      o =
        'init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'.split(
          ' '
        );
      n = 0;
      while (n < o.length) {
        g(u, o[n]);
        n++;
      }
      e._i.push([i, s, a]);
    };
    e.__SV = 1;
  }
})(document, (window as any).posthog || []);

(window as any).posthog.init('phc_nszMZqivMkCWhZRC5bq3XexX5iapQMXzj6u5YPr94B3k', {
  api_host: 'https://us.i.posthog.com',
  person_profiles: 'identified_only',
  cross_subdomain_cookie: true,
  persistence: 'localStorage+cookie',
  autocapture: true,
  capture_pageview: true,
  capture_pageleave: true,
  // 2026-11-19 (PostHog rebuild): click and scroll heatmaps, and clicks that did nothing (dead clicks = the
  // cold-spot / confusion signal). Heatmaps also need "Heatmaps" switched on in the PostHog project settings.
  enable_heatmaps: true,
  capture_dead_clicks: true,
  // 2026-11-19: replays used to record every input except passwords (emails, the feedback note, skill names)
  // and every skill on screen, which is text taken from people's documents. Inputs are masked now, and so is
  // any element marked data-ph-mask (the skill preview, the history names). Hotspots don't need the words.
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: '[data-ph-mask]',
  },
});

// ─── App-level event tracking helpers ─────────────────────────────────────
// posthog.init() above stubs identify/capture synchronously (the snippet queues
// calls until the real script loads), so these are safe to call immediately
// after this module has run, without waiting for the async PostHog script.
declare global {
  interface Window {
    posthog?: {
      identify: (distinctId: string, properties?: Record<string, unknown>, setOnce?: Record<string, unknown>) => void;
      capture: (event: string, properties?: Record<string, unknown>) => void;
      register: (properties: Record<string, unknown>) => void;
      reset: () => void;
    };
  }
}

/** properties are $set on the person (latest wins), setOnce only the first time (where they came from) */
export function identifyUser(distinctId: string, properties?: Record<string, unknown>, setOnce?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.posthog) return;
  window.posthog.identify(distinctId, properties, setOnce);
}

export function captureEvent(name: string, properties?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.posthog) return;
  window.posthog.capture(name, properties);
}

/** Super properties: sent with every later event, autocaptured clicks and heatmap data included */
export function registerProps(properties: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.posthog) return;
  window.posthog.register(properties);
}

/** After a sign-out: the next person on this browser starts as a new anonymous visitor, not as the last account */
export function resetAnalytics(): void {
  if (typeof window === 'undefined' || !window.posthog) return;
  window.posthog.reset();
}

// ─── Sign-in intent, across the Google / GitHub redirect ─────────────────────
// 2026-11-19: a Google or GitHub sign-in leaves the page and comes back through /sso-callback with a full page
// load, so the app could not tell that return from an ordinary visit with a session already there, and every
// OAuth sign-in and sign-up went unrecorded. The sheet notes what was started (sessionStorage: this tab only);
// useIdentify reads it once the account is signed in. Half an hour covers a slow email code.
const AUTH_INTENT = 'rl_auth_intent';
const AUTH_INTENT_MS = 30 * 60 * 1000;
export interface AuthIntent { mode: 'signup' | 'login'; method: string; via: 'unlock' | 'direct'; action?: string; at: number }

export function noteAuthIntent(intent: Omit<AuthIntent, 'at'>): void {
  try { sessionStorage.setItem(AUTH_INTENT, JSON.stringify({ ...intent, at: Date.now() })); } catch { /* storage blocked: the sign-in still counts if it happens on this page */ }
}

/** The intent noted in this tab, if fresh; it is removed, so one sign-in is counted once */
export function takeAuthIntent(): AuthIntent | null {
  try {
    const raw = sessionStorage.getItem(AUTH_INTENT);
    sessionStorage.removeItem(AUTH_INTENT);
    const i = raw ? JSON.parse(raw) : null;
    return i && typeof i.at === 'number' && Date.now() - i.at < AUTH_INTENT_MS ? i : null;
  } catch { return null; }
}
