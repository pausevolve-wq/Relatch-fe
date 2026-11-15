// The sign-up sheet's auth. Production: Clerk (clerkAuth.ts). The sandbox build aliases this module to
// sandboxAuth.ts (vite.sandbox.config.ts), so the prototype keeps its fake auth and its error-path hints.
export { useAuthApi } from './clerkAuth';
