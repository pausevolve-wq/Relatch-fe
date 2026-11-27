// The first-skill note (Manas, 2026-11-09): replaces production's "Get early access" waitlist pop-up for
// people trying Relatch without an account. V3's launch is about learning what people need, so instead of a
// waitlist it reads as a handwritten note from the team asking how it went, what would make it better, and
// (optionally) an email to write back to. Shown once per browser, after the free try's skill is downloaded
// and the install guide is closed (V3App), never to a signed-in account - except right after the unlock sheet
// (2026-11-15): someone who just signed up there to download their free skill gets the note too. Then the email
// field is not asked (Manas: only skip it when we already have their address); the account's address is sent
// with the note instead, so the team can still write back.
//
// Where it goes: a form of its OWN ("Relatch feedback"), apart from Contact's and the waitlist's.
// One form is one table; sharing one would mix the lists (ContactPage.tsx explains the waitlist
// case). 2026-11-17: moved from SplitForms to WebForms. The key is the form's PUBLIC submit key (wft_...),
// VITE_WEBFORMS_FEEDBACK_KEY. Without it in production the note never shows (NOTE_READY), so no note is ever
// written into nowhere. WebForms' free plan: 300 submissions a month, shared by every form, resetting on the 1st
// (was SplitForms: 500 in all, ever, VITE_SPLITFORMS_FEEDBACK_KEY). Success is read from WebForms' `ok: true`.
// Nothing from the document is sent (no skill or file names): only the three answers, the agent, and the
// funnel's session id. Spam: WebForms' honeypot `_gotcha` (as Contact). NOT its time trap: a send under about
// 2 seconds is rejected outright with no copy kept, and "Loved it" then Send is two taps. No native <form>
// submit: the claude.ai artifact frame has no allow-forms.
//
// The ending: the note folds small and flies into the Relatch mark, which opens to catch it and latches shut
// with its full success turn (MarkBuddy `turns`), then the thank-you writes itself in. Reduced motion: the
// thank-you simply appears.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { XIcon } from '@phosphor-icons/react';
import { MarkBuddy, type BuddyMood } from './auth/MarkBuddy';
import { EMAIL } from './auth/emailCode';
import { readStorage, webformsUrl } from '@/engine/core';
import { captureEvent } from '../analytics';
import { cn } from '@/lib/utils';

const FEEDBACK_KEY = (import.meta.env.VITE_WEBFORMS_FEEDBACK_KEY as string | undefined)?.trim()
  // The sandbox's mock backend answers the form calls, so any key does there
  || (import.meta.env.VITE_SANDBOX ? 'sandbox-feedback-key' : '');
/** False in a production build without the feedback form's key: the note is never offered */
export const NOTE_READY = !!FEEDBACK_KEY;

const NOTE_KEY = 'relatch_v3_note';
/** The note was sent or put aside in this browser before. Storage refused: treated as seen (we couldn't
 *  remember a "Not now", so we'd ask on every visit) */
export function noteSeen(): boolean {
  try { return !!localStorage.getItem(NOTE_KEY); } catch { return true; }
}
// Signed-in people who skipped the note see it again when they make another skill or download, copy or open
// one. Someone who filled it (NOTE_KEY = 'sent') never sees it again. So it doesn't nag, never more than once a
// day per browser: the time it last opened is kept here.
const SHOWN_KEY = 'relatch_v3_note_at';
const AGAIN_AFTER_MS = 24 * 60 * 60 * 1000;
/** A signed-in person may be shown the note now: the form is live, they have not filled it (a "Not now" or never
 *  seeing it both count as not filled) and it last opened over a day ago (or never).
 *  Storage refused: not due, since nothing could remember that it was filled or shown. */
export function noteDueAgain(): boolean {
  if (!NOTE_READY) return false;
  try {
    if (localStorage.getItem(NOTE_KEY) === 'sent') return false;
    const at = Number(localStorage.getItem(SHOWN_KEY));
    return !Number.isFinite(at) || Date.now() - at > AGAIN_AFTER_MS;
  } catch { return false; }
}
/** Call when the note opens */
export function markNoteShown() { try { localStorage.setItem(SHOWN_KEY, String(Date.now())); } catch { /* nothing to remember with */ } }
function remember(how: 'sent' | 'dismissed') {
  try { localStorage.setItem(NOTE_KEY, how); } catch { /* nothing to remember with */ }
}

const RATINGS = [
  ['loved', 'Loved it'],
  ['okay', "It's okay"],
  ['not-quite', 'Not quite'],
] as const;
type Rating = (typeof RATINGS)[number][0];
const MAX = 3000; // a note, not an essay (SplitForms cut fields at 10 KB; this stayed well clear)

const hand = 'font-hand'; // v3.css: Kalam, a pen hand that also has Devanagari

// The ink look, chosen by Manas 2026-11-09 over a cream paper sheet: the app's own black and white, so the note
// isn't the one element unlike the rest of the app, while the hand, the tape, the ruled lines, the pen circle and
// the mark keep it a note rather than a form. (The paper palette is in sandbox commit 55218dc if it's ever wanted.)
// Every colour below reads these variables.
const NOTE_COLOURS = {
  '--n-paper': '#111111', '--n-edge': 'rgb(255 255 255 / 0.14)', '--n-ink': '#ededed', '--n-ink2': '#a1a1a1',
  '--n-rule': 'rgb(255 255 255 / 0.1)', '--n-field': 'rgb(255 255 255 / 0.2)', '--n-field-on': 'rgb(255 255 255 / 0.6)',
  '--n-ph': 'rgb(255 255 255 / 0.3)', '--n-tape': 'rgb(255 255 255 / 0.09)', '--n-btn': '#ffffff', '--n-btn-fg': '#000000',
  '--n-btn-hover': 'rgb(255 255 255 / 0.9)', '--n-error': '#ff6369', '--n-hover': 'rgb(255 255 255 / 0.06)',
} as React.CSSProperties;
const ink = 'text-[var(--n-ink)]';
const ink2 = 'text-[var(--n-ink2)]';
const ring = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--n-ink)]';
const button = 'bg-[var(--n-btn)] text-[var(--n-btn-fg)] hover:bg-[var(--n-btn-hover)]';

/** What the mark says beside the note. Short: one line, and a 320px phone leaves it about 200px */
function markLine(o: { stage: Stage; rating: Rating | null; field: 'feedback' | 'email' | null; typed: boolean; failed: boolean }): string {
  if (o.stage === 'sending') return 'Sending it over...';
  if (o.stage === 'thanks') return 'Got it. Thank you!';
  if (o.failed) return "Hmm, that didn't go.";
  if (o.field === 'email') return 'Only about Relatch.';
  if (o.field === 'feedback') return o.typed ? "I'm all ears." : 'Anything at all.';
  if (o.rating === 'loved') return 'That made our day!';
  if (o.rating === 'okay') return "Fair. What'd help?";
  if (o.rating === 'not-quite') return 'Oh no. Tell us more?';
  return 'Psst, a note for you.';
}

type Stage = 'writing' | 'sending' | 'thanks';

/** A loop drawn round the picked answer, the way you'd circle it with a pen */
function PenCircle({ on }: { on: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 120 48" preserveAspectRatio="none" className="pointer-events-none absolute -inset-x-2 -inset-y-1.5 h-[calc(100%+12px)] w-[calc(100%+16px)] overflow-visible">
      <path
        d="M30 8 C60 3 100 6 112 18 C120 30 96 42 60 43 C26 44 6 36 8 24 C10 12 34 6 58 6"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        // Hidden while undrawn too: a round cap on a zero-length dash still paints a dot
        style={{ stroke: 'var(--n-ink)', strokeDashoffset: on ? 0 : 1, opacity: on ? 1 : 0, transition: on ? 'stroke-dashoffset 0.5s cubic-bezier(0.65,0,0.35,1), opacity 0s' : 'stroke-dashoffset 0.15s ease-in, opacity 0s 0.15s' }}
      />
    </svg>
  );
}

/** `askedAs`: this showing came from the signed-in rule (V3App's askAgain): their first look at the note, or a
 *  repeat after a "Not now". Sent as the submission's `source` so WebForms can tell them apart. */
export type SignedInAsk = 'v3-signed-in' | 'v3-signed-in-again';
export function FeedbackNote({ target, onClose, knownEmail, askedAs }: { target: string; onClose: () => void; knownEmail?: string; askedAs?: SignedInAsk }) {
  const [stage, setStage] = useState<Stage>('writing');
  const [rating, setRating] = useState<Rating | null>(null);
  const [feedback, setFeedback] = useState('');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');
  const [failed, setFailed] = useState(false);
  const [field, setField] = useState<'feedback' | 'email' | null>(null);
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null);
  const [hops, setHops] = useState(0);
  const [turns, setTurns] = useState(0);
  const [catching, setCatching] = useState(false);
  // The written note's height, kept by the thank-you, so the card (and the mark above it) don't jump
  const [height, setHeight] = useState<number | null>(null);
  const paper = useRef<HTMLDivElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const markBox = useRef<HTMLSpanElement>(null);
  const pulse = useRef<HTMLSpanElement>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const bot = useRef<HTMLInputElement>(null);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const mood: BuddyMood = stage === 'sending' || catching ? 'watch' : field ? 'watch' : 'idle';
  const say = markLine({ stage, rating, field, typed: feedback.trim().length > 0, failed });

  useEffect(() => { captureEvent('feedback_note_shown', { target, session_id: readStorage('rl_session_id') }); }, [target]);

  // Arrival, in the app's own entrance language: the room dims, the note drifts up and settles (expo, no
  // snap), its lines resolve out of a blur one after another (as Thinking/ComingSoon do), then the mark pops
  // up over the edge and hops. Not elastic: an elastic ease on the opacity reached 0.99 in 50ms (measured
  // 2026-11-09), so the note flashed in before the backdrop had even begun to dim.
  useLayoutEffect(() => {
    const el = fly.current;
    if (!el || reduced()) return;
    const overlay = el.closest('[data-modal]');
    const mark = markBox.current;
    const ctx = gsap.context(() => {
      if (overlay) gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out', clearProps: 'opacity' });
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out', delay: 0.1, clearProps: 'opacity' });
      gsap.fromTo(el, { y: 32, rotate: -4, scale: 0.97 }, { y: 0, rotate: 0, scale: 1, duration: 0.9, ease: 'expo.out', delay: 0.1, clearProps: 'transform' });
      gsap.from(el.querySelectorAll('[data-fold]'), { opacity: 0, y: 6, filter: 'blur(5px)', duration: 0.55, ease: 'expo.out', stagger: 0.05, delay: 0.32, clearProps: 'opacity,transform,filter' });
      if (mark) gsap.fromTo(mark, { opacity: 0, y: 12, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.8)', delay: 0.6, clearProps: 'opacity,transform' });
    });
    const timer = window.setTimeout(() => setHops((n) => n + 1), 1150);
    return () => { ctx.revert(); window.clearTimeout(timer); };
  }, []);

  const close = (how: 'sent' | 'dismissed') => {
    if (how === 'dismissed') captureEvent('feedback_note_dismissed', { target, rating, session_id: readStorage('rl_session_id') });
    remember(how);
    onClose();
  };
  // Escape puts the note aside like "Not now" (caught on the way down, so nothing under it closes too)
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(stage === 'thanks' ? 'sent' : 'dismissed'); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [stage]);

  const lookAt = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setGaze({ x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 }); };

  function pick(r: Rating) {
    setRating(r);
    setProblem('');
    if (r === 'loved') setHops((n) => n + 1);
  }

  async function send() {
    if (stage !== 'writing') return;
    const note = feedback.trim();
    const mail = knownEmail || email.trim();
    if (!rating && !note && (knownEmail || !mail)) { setProblem(knownEmail ? 'Circle one or write a line. Either helps.' : 'Circle one, write a line, or leave your email. Any of the three helps.'); return; }
    if (mail && !EMAIL.test(mail)) { setProblem("That email doesn't look right."); return; }
    setProblem('');
    setFailed(false);
    // A bot filled the honeypot: it's thanked, and nothing is sent
    if (bot.current?.value) { await landNote(); return; }
    setStage('sending');
    const label = RATINGS.find(([r]) => r === rating)?.[1] ?? '';
    // Underscore fields steer WebForms and are not stored as data
    const body = new URLSearchParams({
      _subject: `Relatch note${label ? `: ${label}` : ''}`,
      _gotcha: '',
      rating: label,
      feedback: note,
      target,
      // 2026-11-28 review: a signed-in person's FIRST showing used to fall through to 'v3-unlocked-skill' here
      source: askedAs ?? (knownEmail ? 'v3-unlocked-skill' : 'v3-first-skill'),
      session_id: readStorage('rl_session_id') ?? '',
    });
    // Only with an address: an empty email field, or an empty _replyto, could be refused as invalid
    if (mail) { body.set('email', mail); body.set('_replyto', mail); }
    try {
      const res = await fetch(webformsUrl(FEEDBACK_KEY), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() });
      const json = await res.json().catch(() => null);
      // WebForms answers { ok: true } on success (also when held at the monthly limit), { ok: false } on an error
      if (!res.ok || json?.ok !== true) throw new Error('not stored');
    } catch {
      setStage('writing');
      setFailed(true);
      return;
    }
    captureEvent('feedback_note_sent', { target, rating, has_feedback: !!note, has_email: !!mail, session_id: readStorage('rl_session_id') });
    remember('sent');
    await landNote();
  }

  /** The note folds small, flies into the mark, the mark latches it in, and the thank-you writes itself */
  async function landNote() {
    const card = fly.current;
    const mark = markBox.current;
    setHeight(paper.current?.offsetHeight ?? null);
    if (!card || !mark || reduced()) { setStage('thanks'); setTurns((n) => n + 1); return; }
    setCatching(true);
    const c = card.getBoundingClientRect();
    const m = mark.getBoundingClientRect();
    const dx = m.left + m.width / 2 - (c.left + c.width / 2);
    const dy = m.top + m.height / 2 - (c.top + c.height / 2);
    await gsap.timeline()
      .to(card.querySelectorAll('[data-fold]'), { opacity: 0, duration: 0.2, ease: 'power1.out' })
      .to(card, { scaleX: 0.5, scaleY: 0.35, rotate: -6, duration: 0.28, ease: 'power2.inOut' })
      .to(card, { x: dx, y: dy, scale: 0.06, rotate: -24, duration: 0.62, ease: 'power3.in' })
      .to(card, { opacity: 0, duration: 0.06 })
      .then();
    // Caught: the latch spins home and shuts on it, with a ring of light going out from the mark
    setCatching(false);
    setTurns((n) => n + 1);
    setHops((n) => n + 1);
    if (pulse.current) gsap.fromTo(pulse.current, { scale: 0.6, opacity: 0.55 }, { scale: 2.6, opacity: 0, duration: 1.1, ease: 'expo.out' });
    setStage('thanks');
    gsap.set(card, { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1 });
    gsap.fromTo(card, { opacity: 0, y: 18, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.6)', delay: 0.55, clearProps: 'transform' });
  }

  // The thank-you, written in line by line as by a pen, with its underline drawn last
  useLayoutEffect(() => {
    if (stage !== 'thanks' || !thanks.current || reduced()) return;
    const q = gsap.utils.selector(thanks.current);
    const ctx = gsap.context(() => {
      gsap.fromTo(q('[data-write]'), { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.95, ease: 'power1.inOut', stagger: 0.55, delay: 0.85, clearProps: 'clipPath' });
      // Opacity with it: the undrawn line's round cap would show as a dot before the pen gets there
      gsap.fromTo(q('[data-underline]'), { strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0, opacity: 1, duration: 0.6, ease: 'power2.out', delay: 1.6 });
      gsap.from(q('[data-after]'), { opacity: 0, y: 6, duration: 0.4, ease: 'expo.out', delay: 2.6 });
    }, thanks.current);
    return () => ctx.revert();
  }, [stage]);

  const writing = stage !== 'thanks';
  return createPortal(
    <div data-modal className="fixed inset-0 z-[70] overflow-y-auto bg-black/70 backdrop-blur-md" onPointerDown={(e) => { if (e.target === e.currentTarget) close(writing ? 'dismissed' : 'sent'); }}>
      <div className="flex min-h-full items-center justify-center px-4 pb-8 pt-24 sm:px-6" onPointerDown={(e) => { if (e.target === e.currentTarget) close(writing ? 'dismissed' : 'sent'); }}>
        <div className="relative w-full max-w-[480px]">
          {/* The mark peeks over the note's top edge, on the dark, where its white reads. Left-aligned so its
              speech bubble has room on a phone. */}
          <span ref={markBox} className="absolute -top-[76px] left-5 block">
            <span ref={pulse} aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/60 opacity-0" />
            <MarkBuddy size={64} mood={mood} say={say} gaze={gaze} hops={hops} turns={turns} />
          </span>

          <div ref={fly} role="dialog" aria-modal="true" aria-labelledby="note-title" className="relative origin-center will-change-transform">
            {/* The paper: tilted a little, and straightened while they write in it */}
            <div ref={paper} style={{ ...NOTE_COLOURS, ...(!writing && height ? { minHeight: height } : {}) }} className={cn('group relative flex flex-col justify-center rounded-[6px] bg-[var(--n-paper)] ring-1 ring-[var(--n-edge)] px-6 pb-6 pt-7 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.75),0_2px_0_rgb(0_0_0/0.08)] transition-transform duration-500 ease-out sm:px-8 sm:pb-7 sm:pt-8', writing && '-rotate-[1.2deg] focus-within:rotate-0', ink)}>
              {/* Two strips of tape holding it down */}
              <span aria-hidden className="absolute -top-3 right-8 h-6 w-20 rotate-[4deg] bg-[var(--n-tape)] shadow-[0_1px_2px_rgb(0_0_0/0.15)]" />
              <span aria-hidden className="absolute -bottom-3 left-10 h-6 w-16 -rotate-[3deg] bg-[var(--n-tape)] opacity-90 shadow-[0_1px_2px_rgb(0_0_0/0.12)]" />
              <button type="button" onClick={() => close(writing ? 'dismissed' : 'sent')} aria-label={writing ? 'Not now' : 'Close'} className={cn('absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[var(--n-ink2)] transition-colors hover:bg-[var(--n-hover)] hover:text-[var(--n-ink)]', ring)}><XIcon size={16} /></button>

              {/* Keys: fresh elements for the thank-you. Reused ones would keep the fold-away's inline opacity 0 */}
              {writing ? (
                <div key="writing" className={hand}>
                  <h2 id="note-title" data-fold className="text-balance pr-6 text-[26px] font-bold leading-[1.15] tracking-[-0.01em]">Hey, you made your first skill!</h2>
                  <p data-fold className={cn('mt-2 text-pretty text-[18px] leading-[1.45]', ink2)}>
                    We're a small team building Relatch, and notes from people like you decide what we build next. Got a minute?
                  </p>

                  <p data-fold className="mt-4 text-[19px] font-bold">How did it go?</p>
                  <div data-fold role="radiogroup" aria-label="How did it go?" className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
                    {RATINGS.map(([r, label]) => (
                      <button key={r} type="button" role="radio" aria-checked={rating === r} disabled={!writing || stage === 'sending'} onClick={() => pick(r)} className={cn('relative rounded-full px-2 py-1 text-[19px] leading-none transition-colors', rating === r ? ink : 'text-[var(--n-ink2)] hover:text-[var(--n-ink)]', ring)}>
                        <PenCircle on={rating === r} />
                        {label}
                      </button>
                    ))}
                  </div>

                  <label data-fold className="mt-4 block">
                    <span className="text-[19px] font-bold">What would make Relatch better for you?</span>
                    {/* Ruled lines, so it's written on the note rather than typed into a box */}
                    <textarea
                      value={feedback}
                      maxLength={MAX}
                      rows={2}
                      disabled={stage === 'sending'}
                      onChange={(e) => { setFeedback(e.target.value); setProblem(''); lookAt(e.target); }}
                      onFocus={(e) => { setField('feedback'); lookAt(e.target); }}
                      onBlur={() => { setField(null); setGaze(null); }}
                      placeholder="A feature you missed, a document it got wrong, anything at all..."
                      className="mt-1 block max-h-[160px] w-full resize-none bg-transparent [field-sizing:content] bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,var(--n-rule)_31px,var(--n-rule)_32px)] text-[19px] leading-[32px] text-[var(--n-ink)] outline-none placeholder:text-[var(--n-ph)]"
                    />
                  </label>

                  {knownEmail ? (
                    <p data-fold className={cn('mt-4 font-sans text-[13.5px] leading-snug', ink2)}>We'll write back to <span className="ph-no-capture font-medium text-[var(--n-ink)]">{knownEmail}</span>, only about Relatch.</p>
                  ) : (<>
                  <label data-fold className="mt-4 block">
                    <span className="text-[19px] font-bold">Can we write back? <span className={cn('font-normal', ink2)}>(optional)</span></span>
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      disabled={stage === 'sending'}
                      onChange={(e) => { setEmail(e.target.value); setProblem(''); lookAt(e.target); }}
                      onFocus={(e) => { setField('email'); lookAt(e.target); }}
                      onBlur={() => { setField(null); setGaze(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
                      placeholder="your@email.com"
                      // ph-no-capture: production's PostHog replays record unmasked inputs
                      className="ph-no-capture mt-0.5 block h-10 w-full border-b-[1.5px] border-[var(--n-field)] bg-transparent text-[19px] text-[var(--n-ink)] outline-none transition-colors placeholder:text-[var(--n-ph)] focus:border-[var(--n-field-on)]"
                    />
                  </label>
                  <p data-fold className={cn('mt-2 font-sans text-[12.5px] leading-snug', ink2)}>Only about Relatch, and only now and then. No spam, ever.</p>
                  </>)}
                  <input ref={bot} type="text" name="_gotcha" tabIndex={-1} aria-hidden="true" autoComplete="off" className="hidden" />

                  {(problem || failed) && (
                    <p data-fold role="alert" className="mt-3 text-[17px] leading-snug text-[var(--n-error)]">
                      {problem || "It didn't send. Try again? Your note is still here."}
                    </p>
                  )}

                  {/* Signed at the foot, beside the button (the X, Escape or a tap outside put the note aside) */}
                  {/* Phones: the button full width, signed off underneath (side by side, both wrapped at 390px) */}
                  <div data-fold className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <p className={cn('whitespace-nowrap text-right text-[19px] sm:text-left', ink2)}>— the Relatch team</p>
                    <button type="button" onClick={() => void send()} disabled={stage === 'sending'} className={cn('inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-full px-6 font-sans text-[14.5px] font-medium transition-[background-color,transform,opacity] duration-200 active:scale-[0.98] disabled:opacity-60 sm:w-auto', button, ring)}>
                      {stage === 'sending' ? 'Sending...' : 'Send my note'}
                    </button>
                  </div>
                </div>
              ) : (
                <div key="thanks" ref={thanks} className={cn(hand, 'py-2 text-center')}>
                  <h2 id="note-title" className="relative mx-auto w-fit text-[40px] font-bold leading-none">
                    <span data-write className="block">Thank you!</span>
                    <svg aria-hidden viewBox="0 0 200 14" preserveAspectRatio="none" className="absolute -bottom-3 left-0 h-3.5 w-full overflow-visible">
                      <path data-underline d="M4 9 C40 3 90 4 130 6 C160 7 182 9 196 5" fill="none" style={{ stroke: 'var(--n-ink)' }} strokeWidth="2.4" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="0" />
                    </svg>
                  </h2>
                  <p className={cn('mx-auto mt-6 max-w-[30ch] text-[20px] leading-[1.45]', ink2)}>
                    <span data-write className="block">Your note is in.</span>
                    <span data-write className="block">You just helped shape what Relatch becomes next.</span>
                  </p>
                  <p data-write className={cn('mt-4 text-[19px]', ink2)}>— the Relatch team</p>
                  <button data-after type="button" onClick={() => close('sent')} className={cn('mt-6 inline-flex h-11 items-center justify-center rounded-full px-6 font-sans text-[14.5px] font-medium transition-colors', button, ring)}>Back to my skill</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
