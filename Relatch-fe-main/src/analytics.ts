// Analytics bootstrap — moved out of index.html to allow CSP without 'unsafe-inline' in script-src.
// Imported from src/main.tsx before React mounts so page-load attribution timing is preserved.

// ─── Google Tag Manager ───────────────────────────────────────────────────────
(function (w: any, d: Document, s: string, l: string, i: string) {
  w[l] = w[l] || [];
  w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  const f = d.getElementsByTagName(s)[0];
  const j = d.createElement(s) as HTMLScriptElement;
  const dl = l !== 'dataLayer' ? '&l=' + l : '';
  j.async = true;
  j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
  f.parentNode!.insertBefore(j, f);
})(window, document, 'script', 'dataLayer', 'GTM-P5K7B3C5');

// ─── Google tag (gtag.js / GA4) ───────────────────────────────────────────────
const gtagScript = document.createElement('script');
gtagScript.async = true;
gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-3S6Z146BBL';
document.head.appendChild(gtagScript);

(window as any).dataLayer = (window as any).dataLayer || [];
function gtag(...args: any[]) {
  (window as any).dataLayer.push(args);
}
gtag('js', new Date());
gtag('config', 'G-3S6Z146BBL');

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
  session_recording: {
    maskAllInputs: false,
    maskInputOptions: { password: true },
  },
});

// ─── PostHog event helper exports ────────────────────────────────────────────
// Used by App.tsx for custom event tracking (sign-in funnel, product events).
export function captureEvent(event: string, properties?: Record<string, unknown>) {
  try {
    const ph = (window as any).posthog;
    if (ph && typeof ph.capture === 'function') {
      ph.capture(event, properties);
    }
  } catch {
    // fail silently
  }
}

export function identifyUser(distinctId: string, properties?: Record<string, unknown>) {
  try {
    const ph = (window as any).posthog;
    if (ph && typeof ph.identify === 'function') {
      ph.identify(distinctId, properties);
    }
  } catch {
    // fail silently
  }
}
