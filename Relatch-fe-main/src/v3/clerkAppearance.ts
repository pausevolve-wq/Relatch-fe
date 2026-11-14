// Clerk's own screens (sign in, sign up, the account pop-up) dressed in V3's colours and type.
// Same variable names as the live app's ClerkProvider (src/main.tsx), which are known to work with this
// @clerk/react version; only the values change: V2's navy and blue become V3's black, greys and white.
export const clerkAppearance = {
  variables: {
    colorPrimary: '#ededed',
    colorTextOnPrimaryBackground: '#0a0a0a',
    colorBackground: '#0a0a0a',
    colorText: '#ededed',
    colorTextSecondary: '#a1a1a1',
    colorInputBackground: 'rgba(255,255,255,0.04)',
    colorInputText: '#ededed',
    colorNeutral: '#a1a1a1',
    colorDanger: '#e5484d',
    borderRadius: '0.75rem',
    fontFamily: '"Satoshi", "Segoe UI", system-ui, sans-serif',
  },
  elements: {
    card: { background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 40px 120px rgba(0,0,0,0.7)' },
  },
};
