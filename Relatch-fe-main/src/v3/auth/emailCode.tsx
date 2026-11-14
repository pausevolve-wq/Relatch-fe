/*! Adapted from signup-buddy, Copyright (c) 2026 Adrien Ninet, MIT (github.com/Logiaweb/signup-buddy).
 *  Full licence text: src/v3/auth/THIRD_PARTY_NOTICES.md */
//
// Confirming an email with a 6-digit code: the email field turns into six code boxes once the code is
// sent, then back into the locked address with a check. Sending and checking are the AuthApi's job.
import { useState } from 'react';
import { EMAIL_REGEX } from '@/engine/core';
import { cn } from '@/lib/utils';

// The engine's own check (the Contact form uses it too), so the two never drift apart
export const EMAIL = EMAIL_REGEX;
export const normalEmail = (email: string) => email.trim().toLowerCase();

export type EmailStage = 'typing' | 'code' | 'verified';
export type Purpose = 'signup' | 'login';

/** What an auth call returns: nothing when it worked, or a message to show. `exists`: the address
 *  already has an account (sign-up only), so the sheet moves them to log-in. `on`: which field the
 *  message belongs to (a breached password comes back from the call that sends the code). */
export type Outcome = { error?: string; exists?: boolean; on?: 'email' | 'password'; refused?: EmailRefusal; needsCode?: boolean } | void;
// needsCode (log-in only, 2026-11-15): the password was right but the sign-in needs a code from their inbox
// (Clerk Device Trust on a new device); the sheet moves to its code step.

/** Why the auth service refuses an email (Clerk's verdict at the port, never the sheet's own guess):
 *  invalid = form_param_format_invalid, temporary = form_email_address_blocked ("temporary email services are
 *  not supported"), blocked = not_allowed_access (Clerk's catch-all: blocklist, subaddress, disposable). */
export type EmailRefusal = 'invalid' | 'temporary' | 'blocked';
/** The auth service's answer for an email: fine, refused (and why), or no answer (the check couldn't run) */
export type EmailVerdict = 'ok' | EmailRefusal | null;

/**
 * Props for the sign-up name and email so the browser shows no saved suggestions: Chrome ignores
 * autocomplete="off" on name and email fields but never autofills a search field. inputMode keeps the
 * email keyboard on phones.
 */
export function noAutofill(kind: 'name' | 'email') {
  return {
    type: 'search',
    autoComplete: 'off',
    inputMode: kind === 'email' ? ('email' as const) : ('text' as const),
    autoCapitalize: kind === 'email' ? 'none' : 'words',
    spellCheck: false,
    enterKeyHint: 'next' as const,
  };
}

/** The code's state around the two calls */
export function useEmailCode({
  sendCode,
  verifyCode,
}: {
  sendCode: (email: string, purpose: Purpose) => Promise<Outcome>;
  verifyCode: (email: string, code: string, purpose: Purpose) => Promise<Outcome>;
}) {
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  // (holdFor, which stopped auto-send re-mailing an address after "Change", went with auto-send, 2026-11-06)
  const [busy, setBusy] = useState<'sending' | 'checking' | null>(null);

  const stage = (email: string): EmailStage => (verified === email ? 'verified' : sentTo === email ? 'code' : 'typing');

  return {
    code,
    busy,
    verified,
    stage,
    // No auto-send (2026-11-06, Manas: match production): a code is mailed only when they press
    // Continue / Enter / Resend, never on a typing pause, so a half-typed address is never mailed.
    async send(email: string, purpose: Purpose): Promise<{ error: string; exists: boolean; on: 'email' | 'password'; refused?: EmailRefusal }> {
      setBusy('sending');
      setSentTo(email);
      setCode('');
      const r = await sendCode(email, purpose).then(
        (o) => ({ error: o?.error ?? '', exists: !!o?.exists, on: o?.on ?? ('email' as const), refused: o?.refused }),
        () => ({ error: "We couldn't send the code. Try again.", exists: false, on: 'email' as const }),
      );
      setBusy(null);
      if (r.error || r.exists) setSentTo(null);
      return r;
    },
    /** Takes the boxes' new value; checks the code once all six digits are in */
    async type(email: string, value: string, purpose: Purpose): Promise<{ verified: boolean; error: string }> {
      setCode(value);
      if (value.length < 6 || busy === 'checking') return { verified: false, error: '' };
      setBusy('checking');
      const error = await verifyCode(email, value, purpose).then(
        (r) => r?.error ?? '',
        () => "We couldn't check the code. Try again.",
      );
      setBusy(null);
      if (error) {
        setCode('');
        return { verified: false, error };
      }
      setVerified(email);
      return { verified: true, error: '' };
    },
    /** Back to typing the address, e.g. to fix a typo */
    change() {
      setSentTo(null);
      setCode('');
    },
    reset() {
      setSentTo(null);
      setVerified(null);
      setCode('');
    },
  };
}

/** Six boxes for the email code. One invisible input on top takes typing, paste and the keyboard's code suggestion. */
export function CodeBoxes({
  value,
  disabled,
  onChange,
  onEnter,
  onFocus,
  onBlur,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, 5);
  return (
    // ph-no-capture: production's PostHog replays record inputs unmasked (only passwords are masked),
    // and the code is a credential, both in the input and drawn as text in the boxes
    <div className="ph-no-capture relative">
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            id={`ra-code-box-${i}`}
            className={cn(
              'flex h-12 items-center justify-center rounded-xl bg-white/[0.04] text-[20px] font-semibold text-fg transition-shadow',
              focused && i === active ? 'ring-2 ring-white/60' : 'ring-1 ring-line-2',
              disabled && 'opacity-60',
            )}
          >
            {value[i] ?? (focused && i === active ? <span className="h-5 w-[1.5px] animate-pulse rounded-[1px] bg-fg" /> : null)}
          </span>
        ))}
      </div>
      <input
        id="ra-code"
        aria-label="6-digit code"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        onFocus={() => { setFocused(true); onFocus?.(); }}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}

/** Under the boxes: where the code went, with Change to fix the address and Resend */
export function CodeNote({ email, sending, onChange, onResend }: { email: string; sending: boolean; onChange: () => void; onResend: () => void }) {
  const link = 'underline underline-offset-4 transition-colors hover:text-fg disabled:opacity-50';
  return (
    <p className="mt-3 text-[13px] leading-[1.5] text-fg-2">
      {sending ? 'Sending a code to ' : 'Enter the code sent to '}
      <span className="ph-no-capture break-all text-fg">{email}</span>
      {' · '}
      <button type="button" onClick={onChange} className={link}>Change</button>
      {' · '}
      <button type="button" onClick={onResend} disabled={sending} className={link}>Resend</button>
    </p>
  );
}
