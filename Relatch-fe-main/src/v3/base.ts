// Where V3 is served (2026-11-15, V3 port step 3.3). '/v3/' while it is tested on production beside the current
// app (Relatch-fe's vite.config.ts defines __V3_BASE__); '/' in the sandbox, the claude.ai artifact, and after the
// flip (step 3.5: change the one define). Every URL V3 builds for itself comes from here: the OAuth return
// (auth/clerkAuth.ts), the sign-out landing (main.tsx) and which addresses are the app (ErrorScreens.tsx).
declare const __V3_BASE__: string | undefined;
export const V3_BASE: string = typeof __V3_BASE__ === 'string' ? __V3_BASE__ : '/';

/** A path inside V3: appPath('sso-callback') -> '/v3/sso-callback' (or '/sso-callback' at the root) */
export const appPath = (p = '') => V3_BASE + p.replace(/^\/+/, '');

/** The current address relative to V3 ('/v3/sso-callback' -> '/sso-callback'), or null when it is outside V3 */
export function pathInApp(pathname: string): string | null {
  const base = V3_BASE.replace(/\/+$/, ''); // '' at the root, '/v3' while hidden
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
}
