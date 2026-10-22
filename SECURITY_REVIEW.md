# Frontend security changes for review - 22 October 2026

Local branch: security/analytics-privacy-20261022
Base: 0645bb6c78e81d54fc10fab9eb1421a0c8dec932

Not deployed. No privacy policy changed.

- Disable PostHog replay and automatic element capture. Explicit input/text masking and root blocking remain as defense in depth.
- Stop identifying Clerk accounts to PostHog, disable person-profile creation and cross-subdomain cookies; use in-memory SDK persistence for future visits. Existing stored identifiers and previously collected data are not purged by this patch.
- Allowlist explicit event fields. Drop skill names, filenames, raw auth errors, referrers and caller-supplied identity properties.
- This does not make all analytics anonymous: default SDK network metadata and other analytics integrations remain. Previously collected data is not deleted. Remote PostHog project settings and Google Tag Manager tags need separate owner review.
- Update PDF.js from 6.1.200 to 6.4.299, Vite to 7.3.7 and vite-plugin-singlefile to 2.3.4, and compatible lockfile dependencies to address current npm advisories.

PDF advisory: https://github.com/advisories/GHSA-hq66-cqwq-w95j affects >=5.6.83 <6.2.108. Exploitation requires the documented scripting/CSP conditions; the existing production CSP means package presence alone is not proof of an exploitable app.

Verification: npm run test:privacy (3 tests), npm run build, npm audit. Audit reports no known advisories at review time, not proof of vulnerability absence. Local visual smoke uses a stub Clerk module and validates layout only, not authentication or provider integrations.

Full tsc --noEmit is not green on the existing project. A same-toolchain baseline comparison reports the same diagnostics, only moved line numbers; no broad unrelated type cleanup is included. Test real sign-in, representative PDF extraction/worker load and download flows in an isolated preview before release. No preview/production deployment is authorized by these local changes.

References:
https://posthog.com/docs/session-replay/privacy
https://github.com/advisories/GHSA-hq66-cqwq-w95j
https://github.com/advisories/GHSA-qjx8-664m-686j

## Review-only deployment guard
This branch sets git.deploymentEnabled to false in both repository-root and Relatch-fe-main Vercel configurations, covering either project-root selection. This suppresses automatic Git deployments for code-only review, including previews. It does not prevent manual deployments or promotion and is not a substitute for deployment permissions. Do not merge this review-only guard into main. Remove it only in a separately reviewed release change after staging resources and rollout authority are confirmed.

Official configuration semantics: https://vercel.com/docs/project-configuration/git-configuration
