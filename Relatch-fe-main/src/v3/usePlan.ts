// Skills left today, for Settings > Plan. A free account gets 3 a day (5 until 2026-11-14; relatch lib/usage-limits.js,
// DAILY_LIMIT). The day is the server's UTC date, so it resets at 00:00 UTC: a different hour on every
// clock (5:30 AM in India), which is why the reset is shown as a local time and never as "midnight".
//
// GET /api/usage: built in relatch#34 (api/usage.js, draft until the V3 push). Contract: the same Clerk
// bearer token as /api/enrich; answers { used, limit } for the current UTC day, read from the Redis day
// counter /api/enrich itself counts with (lib/usage-limits.js; usage left Clerk metadata in relatch#32).
// 401 without a token, 503 when the count cannot be read.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { ENRICH_PROXY_URL } from '@/engine/core';

const USAGE_URL = ENRICH_PROXY_URL.replace(/enrich$/, 'usage');

// The next 00:00 UTC, as a time on this person's clock: "5:30 AM".
export function resetTime(now = Date.now()) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return new Date(next).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export interface Plan { used: number; limit: number }

// null while loading, signed out, or when the count could not be read (the panel then says nothing
// rather than a wrong number).
export function usePlan(): Plan | null {
  const { isSignedIn, getToken } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  // Read through a ref: asked once per sign-in state, not again whenever getToken's identity changes
  // (the sandbox's stub makes a new one every render, which looped this request).
  const token = useRef(getToken);
  token.current = getToken;
  useEffect(() => {
    if (!isSignedIn) { setPlan(null); return; }
    let live = true;
    (async () => {
      try {
        const t = await token.current();
        const res = await fetch(USAGE_URL, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
        if (!res.ok) return;
        const v = await res.json();
        if (live && Number.isFinite(v?.used) && Number.isFinite(v?.limit)) setPlan({ used: v.used, limit: v.limit });
      } catch { /* offline: no number is better than a wrong one */ }
    })();
    return () => { live = false; };
  }, [isSignedIn]);
  return plan;
}
