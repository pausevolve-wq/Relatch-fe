/*! Sign-up flow adapted from signup-buddy, Copyright (c) 2026 Adrien Ninet, MIT
 *  (github.com/Logiaweb/signup-buddy). Full licence text: src/v3/auth/THIRD_PARTY_NOTICES.md */
//
// V3's own sign-up / log-in sheet, in place of Clerk's ready-made <SignUp/> and <SignIn/>. The Relatch
// mark watches the form (MarkBuddy): it follows the text cursor, latches shut once a password is being
// typed (not on focus: an empty password field is still watched; Manas, 2026-11-06), thinks
// while a code is on its way, and settles with a quarter turn once they're in.
//   Sign up: email, password and the Terms + Privacy consent on one screen; Continue mails a 6-digit
//            code, and the right code finishes the account. This is production's order and Clerk's
//            documented custom flow (signUp.password -> sendEmailCode -> verifyEmailCode -> finalize),
//            chosen by Manas 2026-11-06 over the earlier email -> code -> password with auto-send.
//            No name: production's Clerk doesn't ask for one (optional there, checked live 2026-11-06).
//   Log in:  email and password. Code: forgot the password, log in with an emailed code instead.
// Log-in grows: the password shows once the email is right. No native <form> submit: the claude.ai
// artifact frame has no allow-forms, so Enter and the button call the step directly.
// The auth itself sits behind AuthApi (sandboxAuth.ts in the prototype, Clerk at the port).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircleIcon, FileTextIcon, LockSimpleIcon, LockSimpleOpenIcon, XIcon } from '@phosphor-icons/react';
import { MarkBuddy, type BuddyMood } from './MarkBuddy';
import { CodeBoxes, CodeNote, EMAIL, noAutofill, normalEmail, useEmailCode, type EmailRefusal, type EmailVerdict, type Outcome, type Purpose } from './emailCode';
import { useAuthApi } from './authApi';
import { cn } from '@/lib/utils';
import { readStorage } from '@/engine/core';
import { captureEvent, noteAuthIntent } from '../../analytics';

export type Provider = 'google' | 'github';
/** The unlock sheet (2026-11-15, Manas's hybrid plan): a signed-out visitor's free skill is shown as a preview;
 *  Copy, Download and "Read the whole skill" open this look of the sheet. Same Clerk steps underneath, only
 *  the header, the ticket for their skill, the buttons and the mark's lines differ. `action` is what they
 *  tapped, carried on by V3App once they're in. */
export type Unlock = { name: string; sections: number; agent: string; action: 'download' | 'copy' | 'read' };
export type AuthApi = {
  /** Start the sign-up with email, password and consent (prod requires legalAccepted), and mail its code */
  startSignUp: (details: { email: string; password: string; legalAccepted: true }) => Promise<Outcome>;
  /** Sign-up: the service's verdict on an email while it's typed, before anything is mailed. At the port this is
   *  Clerk's own check (signUp.create / update with the address), so the mark can never disagree with Clerk */
  checkEmail: (email: string) => Promise<EmailVerdict>;
  /** Mail a 6-digit code: "signup" = send the started sign-up's code again, "login" = a forgotten password */
  sendCode: (email: string, purpose: Purpose) => Promise<Outcome>;
  /** Check the code. For "signup" the right code finishes the account; for "login" it signs them in */
  verifyCode: (email: string, code: string, purpose: Purpose) => Promise<Outcome>;
  logIn: (details: { email: string; password: string }) => Promise<Outcome>;
  /** legalAccepted is sent when the person ticked the box on the sign-up screen */
  oauth: (provider: Provider, opts: { legalAccepted: boolean }) => Promise<Outcome>;
  /** Make the new session live; called after the success animation has had its moment */
  activate: () => void;
  /** Sandbox only: how to try the error paths */
  hint?: string;
};

type Field = 'email' | 'password';
type Focus = Field | 'code' | 'agree';
type Mode = 'signup' | 'login' | 'code';

const FIELDS: Record<Mode, Field[]> = { signup: ['email', 'password'], login: ['email', 'password'], code: ['email'] };
const PASSWORD_MIN = 8;
const LABELS: Record<Field, string> = { email: 'Email', password: 'Password' };
const HINTS: Record<Field, string> = { email: 'Your email', password: 'Your password' };
/** The live public pages (V3's in-app copies have no URL of their own); a new tab keeps the half-filled sheet */
const TERMS_URL = 'https://relatch.online/terms.html';
const PRIVACY_URL = 'https://relatch.online/privacy.html';
const AGREE_FIRST = 'Tick the box to agree to the Terms and Privacy Policy first.';
/** Wait this long after typing stops on a wrongly shaped email before the mark doubts it */
const DOUBT_AFTER = 1200;
/** Sign-up asks the auth service about an address this long after typing stops on one that looks whole */
const CHECK_AFTER = 450;

/** What the mark doubts about the email. The sheet judges only the shape (at once, as anyone could by eye);
 *  a throwaway inbox or a blocked address is the auth service's verdict (Clerk at the port), never the sheet's
 *  own guess, so the mark can't say "looks right" to an address Clerk refuses (Manas, 2026-11-09). */
type EmailIssue = '' | EmailRefusal;
function emailIssue(email: string, verdict: EmailVerdict): EmailIssue {
  if (!email) return '';
  if (!EMAIL.test(email)) return 'invalid';
  return verdict && verdict !== 'ok' ? verdict : '';
}
const REFUSED: Record<EmailRefusal, string> = {
  invalid: "That email doesn't look right.",
  temporary: "Use an email you'll keep, not a temporary one.",
  blocked: "That email can't be used to sign up. Try another one.",
};

/** What's wrong with a field's answer, or "" */
function problemWith(f: Field, values: Record<Field, string>, mode: Mode): string {
  const v = values[f].trim();
  if (f === 'email' && !EMAIL.test(v)) return "That email doesn't look right.";
  if (f === 'password' && !values.password) return 'Add your password.';
  if (f === 'password' && mode === 'signup' && values.password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for your password.`;
  return '';
}

/** One canvas for measuring text, made on first use instead of on every keystroke */
let measure: CanvasRenderingContext2D | null | undefined;

/** Where the text cursor sits in an input, on screen, for the mark to look at */
function caretPoint(input: HTMLInputElement): { x: number; y: number } {
  const box = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  if (measure === undefined) measure = document.createElement('canvas').getContext('2d');
  const ctx = measure;
  const pad = parseFloat(style.paddingLeft);
  let width = 0;
  if (ctx) {
    ctx.font = style.font;
    width = ctx.measureText(input.value.slice(0, input.selectionStart ?? input.value.length)).width;
  }
  return { x: Math.min(box.left + pad + width - input.scrollLeft, box.right - pad), y: box.top + box.height / 2 };
}

/** The value after the last change settles, so the mark doesn't retype on every key */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function mascotLine(o: { error: string; done: boolean; working: boolean; busy: 'sending' | 'checking' | null; field: Focus; signup: boolean; emailOk: boolean; verified: boolean; shut: boolean; doubt: EmailIssue; unlock: boolean }): string {
  // The email's own reason before the generic error line: when Continue is refused, the mark names why
  // (Clerk's verdict), not just "check that one". Kept short: one line beside the mark, ~270px on a phone.
  if (o.doubt === 'temporary') return 'No throwaway emails, please.';
  if (o.doubt === 'blocked') return "That email can't be used here.";
  if (o.doubt === 'invalid') return 'Hmm, that email looks off.';
  if (o.error) return 'Hmm, check that one.';
  if (o.done) return o.unlock ? "Unlocked! It's all yours." : o.signup ? "You're in! Welcome." : "You're in!";
  if (o.working) return 'One second...';
  if (o.busy === 'sending') return 'Sending you a code...';
  if (o.busy === 'checking') return 'Checking your code...';
  if (o.field === 'code') return 'Check your inbox.';
  if (o.shut) return o.unlock ? 'Not peeking. Promise.' : "Latched shut. I'm not looking.";
  if (o.field === 'password') return o.signup ? 'Now pick a password.' : 'And your password.';
  if (o.field === 'agree') return o.unlock ? "One tick and it's yours." : 'Almost there.';
  if (o.verified) return "You're verified!";
  if (o.emailOk) return o.unlock ? 'Perfect. Almost yours.' : 'That looks right.';
  if (o.unlock) return o.signup ? 'I kept your skill safe!' : 'Log in to grab it.';
  return o.signup ? "Hi! What's your email?" : 'Welcome back!';
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-[17px]" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const socialButton = 'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white/[0.05] text-[14.5px] font-medium text-fg ring-1 ring-line-2 transition-colors hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-50';
const inputClass = 'h-12 w-full rounded-xl bg-white/[0.04] px-4 text-[16px] text-fg outline-none ring-1 ring-line-2 transition-shadow placeholder:text-fg-3 focus:ring-2 focus:ring-white/60 [&::-webkit-search-cancel-button]:appearance-none';
const textLink = 'font-medium text-fg underline underline-offset-4 transition-colors hover:text-white';

export function AuthSheet({ view, onClose, unlock }: { view: 'sign-in' | 'sign-up'; onClose: () => void; unlock?: Unlock }) {
  const api = useAuthApi();
  const panel = useRef<HTMLDivElement>(null);
  const ticket = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(view === 'sign-up' ? 'signup' : 'login');
  // Production's sign-in funnel events (the old App.tsx AuthGate), same names, from V3's own sheet (2026-11-15)
  const signInEvent = (name: string, extra: Record<string, unknown> = {}) => captureEvent(name, { ...extra, session_id: readStorage('rl_session_id') });
  useEffect(() => { if (mode === 'login') signInEvent('clerk_signin_opened'); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (unlock) signInEvent('unlock_sheet_opened', { action: unlock.action, agent: unlock.agent }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const signup = mode === 'signup';
  // 2026-11-19 (PostHog rebuild): what this sheet is starting, noted before a sign-in can leave the page (Google,
  // GitHub), so useIdentify can count it when the account comes back signed in. Sign-ups get their own start event.
  // Once per sheet and method: a resent code or a second tap is not a second start.
  const signupStarted = useRef(new Set<string>());
  const intend = (method: string) => {
    noteAuthIntent({ mode: signup ? 'signup' : 'login', method, via: unlock ? 'unlock' : 'direct', action: unlock?.action });
    if (signup && !signupStarted.current.has(method)) {
      signupStarted.current.add(method);
      signInEvent('signup_started', { method, via: unlock ? 'unlock' : 'direct', unlock_action: unlock?.action });
    }
  };
  const usesCode = mode !== 'login';
  const [done, setDone] = useState(false);
  const [working, setWorking] = useState<null | 'submit' | Provider>(null);
  const pending = done || working !== null;

  const fields = FIELDS[mode];
  const [values, setValues] = useState<Record<Field, string>>({ email: '', password: '' });
  const [agreed, setAgreed] = useState(false);
  // Sign-up shows email and password together (production's screen); log-in grows field by field
  const [shown, setShown] = useState(view === 'sign-up' ? FIELDS.signup.length : 1);
  const [focused, setFocused] = useState<Focus | null>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const all = shown === fields.length;

  // The sign-up the code belongs to; email or password changed after "Change" -> start a new one
  const started = useRef('');
  const emailCode = useEmailCode({
    sendCode: async (to, purpose) => {
      const key = `${to}\n${values.password}`;
      if (purpose !== 'signup' || started.current === key) return api.sendCode(to, purpose);
      const r = await api.startSignUp({ email: to, password: values.password, legalAccepted: true });
      if (!r?.error && !r?.exists) started.current = key;
      return r;
    },
    verifyCode: api.verifyCode,
  });
  const { busy } = emailCode;
  const email = normalEmail(values.email);
  const emailOk = EMAIL.test(email);
  // Sign-up: the auth service's verdict on the address exactly as typed now (null = not asked yet, or no answer)
  const [checked, setChecked] = useState<{ email: string; verdict: EmailVerdict } | null>(null);
  const verdict: EmailVerdict = signup && checked?.email === email ? checked.verdict : null;
  const latestEmail = useRef(email);
  latestEmail.current = email;
  // "Looks right" only when the service said so (sign-up); log-in judges the shape alone, as Clerk does there
  // (its throwaway block skips sign-ins: allowlist_blocklist_disabled_on_sign_in, checked live 2026-11-09)
  const emailGood = signup ? verdict === 'ok' : emailOk;
  const emailStage = usesCode ? emailCode.stage(email) : 'typing';

  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null);
  const [hops, setHops] = useState(0);
  const [shakes, setShakes] = useState(0);
  const [turns, setTurns] = useState(0);
  // The email problem the mark has reacted to; it doubts only while that same problem is still there, so
  // fixing the address (or a different problem) clears it and the next reaction is a fresh one
  const issue = emailIssue(email, verdict);
  const [flagged, setFlagged] = useState<EmailIssue>('');
  // Read by react(), which also runs from a timer and an awaited check (a stale `flagged` there would double-shake)
  const flaggedRef = useRef(flagged);
  flaggedRef.current = flagged;
  const doubt = flagged && flagged === issue ? flagged : '';
  // With nothing focused, the mark talks about the first field still waiting for an answer
  const field: Focus = focused ?? (emailStage === 'code' ? 'code' : fields.slice(0, shown).find((f) => problemWith(f, values, mode)) ?? fields[shown - 1]);
  // The latch shuts only once there is a password to hide, not the moment the field gets focus
  const shut = focused === 'password' && values.password.length > 0;
  const line = useSettled(mascotLine({ error, done, working: working !== null, busy, field, signup, emailOk: emailGood, verified: emailStage === 'verified', shut, doubt, unlock: !!unlock }), 350);
  // Unlock: keen (eager) while nothing is going on, a smile (glee) once it's theirs
  const mood: BuddyMood = done ? (unlock ? 'glee' : 'idle') : busy || working ? 'busy' : shut ? 'shut' : doubt ? 'doubt' : focused ? 'watch' : unlock ? 'eager' : 'idle';

  // Unlock: the mark hops and looks at their skill as the sheet arrives, then goes back to the pointer
  useEffect(() => {
    if (!unlock) return;
    const look = window.setTimeout(() => {
      const box = ticket.current?.getBoundingClientRect();
      if (box) setGaze({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      setHops((n) => n + 1);
    }, 320);
    const free = window.setTimeout(() => setGaze((g) => (focusedRef.current ? g : null)), 1900);
    return () => { window.clearTimeout(look); window.clearTimeout(free); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The mark's answer to a wrong or throwaway email: a head shake, then doubt until it's fixed. Once per problem. */
  function react(kind: EmailRefusal) {
    if (flaggedRef.current === kind) return;
    flaggedRef.current = kind;
    setFlagged(kind);
    setShakes((n) => n + 1);
  }

  // A wrong email: typing stopped on an address that has reached its "@" (they think it's whole) and still
  // fails. Before the "@" it waits for them to leave the field or press Continue, so it never nags mid-name.
  useEffect(() => {
    if (focused !== 'email' || pending || issue !== 'invalid' || flagged === 'invalid' || !email.includes('@')) return;
    const timer = window.setTimeout(() => react('invalid'), DOUBT_AFTER);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react() only reads `flagged`, listed here
  }, [focused, pending, issue, flagged, email]);

  // Sign-up: once typing stops on an address that looks whole, ask the auth service (nothing is mailed). Its
  // answer is the mark's: "ok" hops and says it looks right, a refusal shakes and says why. No answer (the
  // check failed) leaves the mark neutral, and Continue gets the final word from the same service.
  useEffect(() => {
    if (!signup || pending || emailStage !== 'typing' || !emailOk || checked?.email === email) return;
    const timer = window.setTimeout(async () => {
      const answer = await api.checkEmail(email).catch(() => null);
      if (latestEmail.current !== email) return; // typed on meanwhile: a stale answer
      setChecked({ email, verdict: answer });
      if (answer === 'ok') setHops((n) => n + 1);
      else if (answer) react(answer);
    }, CHECK_AFTER);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- api is rebuilt each render; react() reads a ref
  }, [signup, pending, emailStage, emailOk, email, checked]);

  useEffect(() => {
    // Caught on the way down, so Escape closes this sheet and not a panel under it
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  useEffect(() => {
    // aria-modal: keyboard users land inside the sheet (on the panel, so no phone keyboard pops up),
    // Tab stays inside it, and focus goes back to what opened it on close
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      const el = panel.current;
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])')]
        .filter((n) => !(n as HTMLButtonElement).disabled && n.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === el || !el.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !el.contains(at))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', trap);
    return () => { window.removeEventListener('keydown', trap); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.parentElement?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    // A sheet from the bottom on phones, a pop-up elsewhere (the same entrance as V3's Modal)
    const phone = window.matchMedia('(max-width: 639px)').matches;
    el.animate(
      phone ? [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }] : [{ opacity: 0, transform: 'translateY(8px) scale(0.97)' }, { opacity: 1, transform: 'translateY(0px) scale(1)' }],
      { duration: phone ? 420 : 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
  }, []);

  function focusField(f: Focus, tries = 30) {
    // Once the render that shows it lands; the email's spot holds the code boxes while a code is pending
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`#ra-${f}`) ?? (f === 'email' ? document.querySelector<HTMLInputElement>('#ra-code') : null);
      if (input && !input.disabled) input.focus();
      else if (tries > 0) focusField(f, tries - 1);
    });
  }

  function complain(f: Focus, problem: string) {
    setError(problem);
    setShakes((n) => n + 1);
    // Continue on a wrong email: the same doubt as the typing pause, held until it's fixed (no second shake)
    if (f === 'email' && issue) setFlagged(issue);
    focusField(f);
  }

  function finish(method: string) {
    if (unlock) signInEvent('unlock_auth_success', { action: unlock.action, mode: signup ? 'signup' : 'login', method });
    setDone(true);
    setWorking(null);
    setHops((n) => n + 1);
    setTurns((n) => n + 1);
    // Let the latch settle before the sheet closes (V3App closes it once signed in). Unlock holds a little
    // longer, so "Unlocked! It's all yours." is read and the lock is seen opening before the sheet goes.
    window.setTimeout(api.activate, unlock ? 1900 : 750);
  }

  /** Already has an account: on to log-in with the address kept, straight to the password */
  function toLogin() {
    setMode('login');
    setShown(2);
    emailCode.reset();
    setError('');
    setNote('That email already has an account. Log in instead.');
    setHops((n) => n + 1);
    focusField('password');
  }

  async function sendEmailCode() {
    intend('email_code');
    const r = await emailCode.send(email, signup ? 'signup' : 'login');
    if (r.exists) return toLogin();
    if (r.error) {
      complain(r.on, r.error);
      // Refused at Continue: the service's final word, and the mark shows the same (whatever the check said)
      if (r.refused) {
        setChecked({ email, verdict: r.refused });
        flaggedRef.current = r.refused;
        setFlagged(r.refused);
      }
      return;
    }
    setError('');
    setHops((n) => n + 1);
    focusField('code');
  }

  function changeEmail() {
    // Not while the code is being checked: a right code landing after "Change" would still finish the account
    if (busy === 'checking') return;
    emailCode.change();
    setError('');
    focusField('email');
  }

  async function social(provider: Provider) {
    if (pending) return;
    // A new account needs the consent, the same as production's Clerk screen
    if (signup && !agreed) return complain('agree', AGREE_FIRST);
    setError('');
    setNote('');
    setWorking(provider);
    if (!signup) signInEvent('clerk_signin_attempted', { method: provider, user_agent: navigator.userAgent, referrer: document.referrer });
    intend(provider);
    const result = await api.oauth(provider, { legalAccepted: signup && agreed }).catch(() => ({ error: "We couldn't reach the sign-in. Try again." }));
    if (result?.error) {
      setWorking(null);
      if (!signup) signInEvent('clerk_signin_failed', { method: provider, error: result.error });
      return complain(fields[0], result.error);
    }
    finish(provider);
  }

  /** Sign-up: everything checked here, then Continue mails the code (nothing is mailed before this) */
  function startSignUp() {
    for (const f of fields) {
      const problem = problemWith(f, values, mode);
      if (problem) return complain(f, problem);
    }
    // Already refused by the service while typing: no need to ask again
    if (verdict && verdict !== 'ok') return complain('email', REFUSED[verdict]);
    if (!agreed) return complain('agree', AGREE_FIRST);
    if (!busy) void sendEmailCode();
  }

  /** Enter or Continue on a field: on to the next one, or the step's action on the last */
  function advanceFrom(f: Field) {
    if (pending) return;
    if (signup) {
      if (f === 'email' && !values.password) {
        if (!emailOk) return complain('email', "That email doesn't look right.");
        return focusField('password');
      }
      return startSignUp();
    }
    if (f === 'email' && mode === 'code') {
      if (!emailOk) return complain('email', "That email doesn't look right.");
      if (emailStage === 'typing' && !busy) void sendEmailCode();
      else if (emailStage === 'code') focusField('code');
      return;
    }
    const problem = problemWith(f, values, mode);
    if (problem) return complain(f, problem);
    const index = fields.indexOf(f);
    if (index === fields.length - 1) return void submit();
    if (index + 1 >= shown) setHops((n) => n + 1);
    setShown((n) => Math.max(n, index + 2));
    focusField(fields[index + 1]);
  }

  /** Log-in with email and password (sign-up finishes at its code instead) */
  async function submit() {
    setError('');
    setWorking('submit');
    signInEvent('clerk_signin_attempted', { method: 'password', user_agent: navigator.userAgent, referrer: document.referrer });
    intend('password');
    const result: Outcome = await api.logIn({ email, password: values.password }).catch(() => ({ error: 'Something went wrong. Try again.' }));
    if (result?.error) {
      setWorking(null);
      signInEvent('clerk_signin_failed', { method: 'password', error: result.error });
      return complain('password', result.error);
    }
    // 2026-11-15: a new device (Clerk Device Trust, on in production) or an email second factor. The password
    // was right; the sign-in finishes with a code sent to their inbox, on the same code step "Email me a code" uses.
    if (result?.needsCode) {
      setWorking(null);
      setMode('code');
      setShown(1);
      setNote('New device. We sent a code to your email to make sure it\'s you.');
      await sendEmailCode();
      return;
    }
    finish('password');
  }

  function primary() {
    if (emailStage === 'code') {
      if (emailCode.code.length === 6) void changeCode(emailCode.code);
      else focusField('code');
      return;
    }
    advanceFrom(fields[shown - 1]);
  }

  function switchMode(to: Mode) {
    if (pending) return;
    setMode(to);
    setShown(to === 'signup' ? FIELDS.signup.length : 1);
    setError('');
    setNote('');
    setFlagged('');
    emailCode.reset();
    setGaze(null);
  }

  function change(f: Field, e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (f === 'email') {
      const next = normalEmail(value);
      const nextIssue = emailIssue(next, signup && checked?.email === next ? checked.verdict : null);
      if (nextIssue !== flagged) { flaggedRef.current = ''; setFlagged(''); }
      // Log-in hops the moment the shape is right (nothing more is judged there); sign-up hops on the service's "ok"
      if (!signup && next && !nextIssue && !emailOk) setHops((n) => n + 1);
    }
    setValues((v) => ({ ...v, [f]: value }));
    setError('');
    // An empty password field is watched like any other; once it has text the latch shuts and looks away
    if (f !== 'password' || !value) setGaze(caretPoint(e.target));
  }

  async function changeCode(value: string) {
    setError('');
    const box = document.getElementById(`ra-code-box-${Math.min(value.length, 5)}`)?.getBoundingClientRect();
    if (box) setGaze({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    const result = await emailCode.type(email, value, signup ? 'signup' : 'login');
    if (result.error) {
      if (!signup) signInEvent('clerk_signin_failed', { method: 'email_code', error: result.error });
      return complain('code', result.error);
    }
    if (!result.verified) return;
    // Sign-up: the right code finishes the account (email + password were given before the code)
    finish('email_code');
  }

  /** Sign-up skips the browser's saved suggestions on the email; log-in keeps them, and password managers get the password */
  function typeProps(f: Field) {
    if (f === 'password') return { type: 'password', autoComplete: signup ? 'new-password' : 'current-password', enterKeyHint: 'go' as const };
    return signup ? noAutofill(f) : { type: 'email', autoComplete: f, enterKeyHint: 'next' as const };
  }

  function follow(f: Field, e: React.SyntheticEvent<HTMLInputElement>) {
    setFocused(f);
    if (f !== 'password' || !e.currentTarget.value) setGaze(caretPoint(e.currentTarget));
  }

  // Log-in: once typing pauses on a right email, show the password field. Never mails anything.
  // No dependency list: every render restarts the timer, so it only fires after a pause.
  useEffect(() => {
    if (pending || signup) return;
    const timer = window.setTimeout(() => {
      let filled = 0;
      while (filled < fields.length - 1 && !problemWith(fields[filled], values, mode)) filled++;
      if (filled + 1 <= shown) return;
      setShown(filled + 1);
      setHops((h) => h + 1);
      // Focus stays where it is (item 4, approved 2026-11-09): a pause is not a finished email ("name@gmail.c"
      // passes the check), so jumping sent the rest of the address into the password. Enter, Tab or a tap moves on.
    }, 900);
    return () => window.clearTimeout(timer);
  });

  const title = unlock ? (done ? "It's yours" : 'Your skill is ready') : signup ? 'Create your free account' : mode === 'code' ? 'Log in with a code' : 'Welcome back';
  const subtitle = unlock
    ? done ? { download: 'Downloading it now.', copy: 'Copying it for you.', read: 'Opening the whole skill.' }[unlock.action]
    // 2026-11-19 (Manas picked it): an unlock is now one of the day's 3 (relatch#50), so the old "You also get 3 new
    // skills a day" read as 3 on top. Sign-up only: a new account is at 0 of 3, so "2 more" is always true there.
    : (signup ? 'Unlock this skill free, plus 2 more today. No card needed.' : mode === 'code' ? "We'll email you a 6-digit code, then it's yours." : 'Log in to download it and keep it.')
    : signup ? 'Save every skill you make, on any device.' : mode === 'code' ? "We'll email you a 6-digit code." : 'Log in to pick up where you left off.';
  const label = working === 'google' ? 'Opening Google...' : working === 'github' ? 'Opening GitHub...'
    : done ? (unlock ? 'Unlocked' : "You're in")
    : working ? (signup ? 'Creating your account...' : 'Logging in...')
    : busy === 'checking' ? 'Checking...'
    // (no "Sending your code..." here: send() shows the code boxes the moment it starts, and their note
    // says the code is on its way)
    : signup && emailStage === 'code' ? (unlock ? 'Unlock my skill' : 'Create my free account')
    : all && mode === 'login' ? (unlock ? 'Log in and unlock' : 'Log in')
    : 'Continue';

  return createPortal(
    // data-modal: a press in here is not "outside" a popover under it (useDismiss), as for Modal
    <div data-modal className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-6" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ra-title"
        tabIndex={-1}
        className="relative outline-none max-h-[92dvh] w-full max-w-[420px] overflow-y-auto overflow-x-hidden scroll-none rounded-t-[28px] border border-b-0 border-line-2 bg-ink-1 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] text-fg shadow-[0_40px_120px_rgb(0_0_0/0.7)] sm:rounded-[28px] sm:border-b sm:p-8"
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/70">
          <XIcon size={18} />
        </button>

        {/* Unlock: their skill, held for them. The lock opens once they're in. */}
        {unlock && (
          <div ref={ticket} className="mb-5 mr-10 flex items-center gap-3 rounded-2xl border border-line-2 bg-white/[0.03] px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-fg"><FileTextIcon size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-medium text-fg">{unlock.name}</span>
              <span className="block truncate text-[12.5px] text-fg-2">{unlock.agent} skill · {unlock.sections} {unlock.sections === 1 ? 'section' : 'sections'}</span>
            </span>
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-300', done ? 'bg-white text-black' : 'bg-white/[0.06] text-fg-2')} aria-label={done ? 'Unlocked' : 'Locked'}>
              {done ? <LockSimpleOpenIcon size={15} weight="bold" className="ra-rise" /> : <LockSimpleIcon size={15} weight="bold" />}
            </span>
          </div>
        )}
        <h2 id="ra-title" className="pr-8 text-[24px] font-semibold leading-[1.15] tracking-[-0.03em]">{title}</h2>
        <p className="mt-1.5 text-[14.5px] leading-[1.5] text-fg-2">{subtitle}</p>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void social('google')} disabled={pending} className={socialButton}><GoogleG />Google</button>
          <button type="button" onClick={() => void social('github')} disabled={pending} className={socialButton}><GitHubMark />GitHub</button>
        </div>
        <p className="mt-5 flex items-center gap-3 text-[13px] text-fg-3 before:h-px before:flex-1 before:bg-line-2 after:h-px after:flex-1 after:bg-line-2">or with your email</p>

        {/* The mark sits right above the fields it watches */}
        <MarkBuddy size={68} mood={mood} say={line} gaze={gaze} hops={hops} shakes={shakes} turns={turns} className="mt-5" />

        <div key={mode} className="mt-5 flex flex-col gap-3">
          {/* Sign-up: once the code is sent, the boxes take the email's place and the password steps aside */}
          {fields.slice(0, shown).filter((f) => !(signup && emailStage === 'code' && f === 'password')).map((f, i) =>
            f === 'email' && emailStage === 'code' ? (
              <div key="code" className="ra-rise">
                <CodeBoxes
                  value={emailCode.code}
                  disabled={busy === 'checking' || pending}
                  onChange={(v) => void changeCode(v)}
                  onEnter={primary}
                  onFocus={() => setFocused('code')}
                  onBlur={() => { setFocused(null); setGaze(null); }}
                />
                <CodeNote email={email} sending={busy === 'sending'} onChange={changeEmail} onResend={() => { if (!busy) void sendEmailCode(); }} />
              </div>
            ) : (
              <label key={f} className={cn('relative block', i > 0 && 'ra-rise')}>
                <input
                  id={`ra-${f}`}
                  name={f}
                  {...typeProps(f)}
                  value={values[f]}
                  readOnly={(f === 'email' && emailStage === 'verified') || pending}
                  onChange={(e) => change(f, e)}
                  onFocus={(e) => follow(f, e)}
                  onClick={(e) => follow(f, e)}
                  onKeyUp={(e) => follow(f, e)}
                  // Leaving a wrong email (any wrong one, "@" or not) gets the same doubt as a typing pause
                  onBlur={() => { setFocused(null); setGaze(null); if (f === 'email' && issue === 'invalid' && !pending) react('invalid'); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); advanceFrom(f); } }}
                  aria-label={LABELS[f]}
                  placeholder={f === 'password' && signup ? `Choose a password (${PASSWORD_MIN}+ characters)` : HINTS[f]}
                  // ph-no-capture on the email: production's PostHog replays record unmasked inputs
                  className={cn(inputClass, f === 'email' && 'ph-no-capture', f === 'email' && emailStage === 'verified' && 'pr-12 text-fg-2 focus:ring-1 focus:ring-line-2')}
                />
                {f === 'email' && emailStage === 'verified' && (
                  <CheckCircleIcon size={20} weight="fill" aria-label="Email verified" className="absolute right-4 top-1/2 -translate-y-1/2 text-white" />
                )}
              </label>
            ),
          )}

          {mode === 'login' && all && (
            <p className="-mt-1 text-[13px] text-fg-2">
              Forgot your password?{' '}
              <button type="button" onClick={() => switchMode('code')} className={textLink}>Get a code by email</button>
            </p>
          )}

          {signup && emailStage !== 'code' && (
            <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-[1.5] text-fg-2">
              <input
                id="ra-agree"
                type="checkbox"
                checked={agreed}
                disabled={pending}
                onChange={(e) => { setAgreed(e.target.checked); setError(''); }}
                onFocus={() => setFocused('agree')}
                onBlur={() => setFocused(null)}
                className="mt-[3px] size-4 shrink-0 cursor-pointer accent-white"
              />
              <span>
                I agree to the{' '}
                <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={textLink}>Terms of Service</a>
                {' '}and{' '}
                <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={textLink}>Privacy Policy</a>
              </span>
            </label>
          )}

          {note && !error && <p className="text-[13.5px] text-fg-2">{note}</p>}
          {error && <p role="alert" className="text-[13.5px] text-[#ff6369]">{error}</p>}

          {/* Clerk's bot protection draws its challenge here at the port; empty and zero-height until then */}
          {signup && <div id="clerk-captcha" />}

          <button
            type="button"
            onClick={primary}
            disabled={pending || busy === 'checking' || (emailStage === 'code' ? emailCode.code.length < 6 : busy !== null)}
            className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-[15px] font-medium text-black transition-[background-color,transform,opacity] duration-200 hover:bg-white/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45 disabled:active:scale-100"
          >
            {label}
          </button>
        </div>

        <p className="mt-4 text-center text-[14px] text-fg-2">
          {signup ? 'Already have an account? ' : mode === 'code' ? 'Remember your password? ' : 'New here? '}
          <button type="button" onClick={() => switchMode(signup || mode === 'code' ? 'login' : 'signup')} className={textLink}>
            {signup || mode === 'code' ? 'Log in' : 'Create a free account'}
          </button>
        </p>

        {api.hint && <p className="mt-5 border-t border-dashed border-line-2 pt-3 text-center text-[11.5px] leading-[1.5] text-fg-3">{api.hint}</p>}
      </div>
    </div>,
    document.body,
  );
}
