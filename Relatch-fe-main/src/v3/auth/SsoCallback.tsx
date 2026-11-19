// /sso-callback: where Google and GitHub send people back (Clerk's redirectCallbackUrl). Written 2026-11-15
// for the V3 port. Clerk's HandleSSOCallback finishes the sign-in or sign-up; this page decides where to go next.
//
// The one case it handles itself: a NEW person who chose Google/GitHub on the log-in screen. Their sign-in is
// transferred to a sign-up that has no legal consent (production requires it), so Clerk sends them to
// navigateToSignUp. They tick the same box the sign-up screen has, the sign-up gets legalAccepted, and the
// account is finished here. Everyone else goes straight back into the app.
import { useState } from 'react';
import { HandleSSOCallback, useSignUp } from '@clerk/react';
import { appUrls } from './clerkAuth';
import { appPath } from '../base';
import { readError } from './clerkAuthCore';
import { RelatchMark } from '../RelatchMark';

// 2026-11-20: the app's own legal pages, as on the sign-up sheet (AuthSheet.tsx)
const TERMS_URL = appPath('terms-of-service');
const PRIVACY_URL = appPath('privacy-policy');

function go(url: string) {
  window.location.replace(url);
}

function Consent() {
  const { signUp } = useSignUp();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function finish() {
    if (!agreed) return setError('Tick the box to agree to the Terms and Privacy Policy first.');
    setBusy(true);
    setError('');
    const err = readError((await signUp.update({ legalAccepted: true })).error);
    if (err || signUp.status !== 'complete') {
      setBusy(false);
      return setError(err?.message || "We couldn't finish your account. Try signing up again.");
    }
    await signUp.finalize();
    go(appUrls().appUrl);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4 text-fg">
      <div className="w-full max-w-[400px] rounded-[24px] border border-line-2 bg-ink-1 px-6 pb-6 pt-7 shadow-[0_40px_120px_rgb(0_0_0/0.7)]">
        <RelatchMark still size={28} className="text-fg" />
        <h1 className="mt-5 text-[20px] font-semibold tracking-[-0.02em]">One last step</h1>
        <p className="mt-2 text-[14px] leading-[1.55] text-fg-2">You're new to Relatch. Agree to the terms to finish creating your account.</p>
        <label className="mt-5 flex cursor-pointer items-start gap-3 text-[13.5px] leading-[1.5] text-fg-2">
          <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setError(''); }} className="mt-0.5 size-4 shrink-0 accent-white" />
          <span>
            I agree to the <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-fg underline underline-offset-4">Terms of Service</a> and{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-fg underline underline-offset-4">Privacy Policy</a>
          </span>
        </label>
        {error && <p role="alert" className="mt-3 text-[13px] text-[#ff6369]">{error}</p>}
        <button onClick={finish} disabled={busy} className="mt-5 h-11 w-full rounded-full bg-white text-[14.5px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-50">
          {busy ? 'Finishing…' : 'Create my account'}
        </button>
        <button onClick={() => go(appUrls().appUrl)} className="mt-2 h-10 w-full rounded-full text-[13.5px] text-fg-3 transition-colors hover:text-fg-2">Cancel</button>
      </div>
    </main>
  );
}

export function SsoCallback() {
  const [needsConsent, setNeedsConsent] = useState(false);
  if (needsConsent) return <Consent />;
  return (
    <>
      <main className="grid min-h-dvh place-items-center bg-ink text-fg-3" aria-busy="true">
        <RelatchMark state="thinking" glow={false} size={28} className="text-fg" />
      </main>
      <HandleSSOCallback
        navigateToApp={({ decorateUrl }) => go(decorateUrl(appUrls().appUrl))}
        // A sign-in that needs another step (a new device): back to the app's log-in, which handles it
        navigateToSignIn={() => go(`${appUrls().appUrl}?auth=sign-in`)}
        navigateToSignUp={() => setNeedsConsent(true)}
      />
    </>
  );
}
