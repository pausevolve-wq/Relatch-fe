// Contact: a page of its own (like the API platform was, until 2026-11-03: no sidebar, one way back) with a short form, instead
// of a mailto: link that opens whichever mail app the person may not even use.
//
// Where a message goes: a SplitForms form of its OWN, not the waitlist's. One SplitForms form is one list.
// Sharing the waitlist's would put messages in the waitlist, make its duplicate check (api/waitlist-check)
// tell someone who wrote in that they are already signed up, and land messages in the waitlist's Airtable
// archive. The access key is SplitForms' PUBLIC submit key (safe in the browser, like the waitlist's); the
// private read token never comes near the frontend.
//
// PRODUCTION NEEDS THE KEY: create a second form in SplitForms ("Relatch contact"), set its notification
// email, and put its access key in VITE_SPLITFORMS_CONTACT_KEY. Until then every send falls back to the
// email address below. So does SplitForms' free-plan limit: 500 submissions in all, ever, across every
// form; past it SplitForms answers 429 and stores nothing.
//
// Spam: SplitForms' honeypot, `botcheck`, a hidden checkbox people never tick. Its other trap,
// `form_loaded_at`, is not used: its format is undocumented, and a wrong guess would send real messages
// to the spam queue, which sends no notification.
// Sent without a native <form> submit: the claude.ai artifact frame has no allow-forms (as ApiPlatform found, removed 2026-11-03).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { ArrowLeftIcon, PaperPlaneTiltIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { RelatchMark } from './RelatchMark';
import { EMAIL_REGEX, SPLITFORMS_ENDPOINT } from '@/engine/core';
import { cn } from '@/lib/utils';

const CONTACT_KEY = (import.meta.env.VITE_SPLITFORMS_CONTACT_KEY as string | undefined)?.trim() || '';
export const CONTACT_EMAIL = 'hello@relatch.online';
const MAX = 5000; // SplitForms keeps 10 KB a field and cuts the rest; 5,000 characters stays clear of that

const TOPICS = [
  ['question', 'A question', 'What would you like to know?'],
  ['problem', "Something's not working", 'What happened, and what did you expect? The kind of document helps (PDF, Word, code).'],
  ['feedback', 'Feedback', "What's working for you, and what isn't?"],
  ['partnership', 'Partnerships', 'Who you are, and what you have in mind.'],
] as const;
type Topic = (typeof TOPICS)[number][0];

const ring = 'focus-visible:outline-2 focus-visible:outline-white/60';
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A line that answers what the message was about, so the thanks reads as a reply to it, not a receipt.
const THANKS: Record<Topic, string> = {
  question: 'Questions like yours help us make Relatch clearer for everyone.',
  problem: "Sorry it gave you trouble. We'll look into what happened and get back to you.",
  feedback: 'Feedback like this shapes what we build next. Thank you for taking the time.',
  partnership: "We'd love to hear more, and we'll reply to you personally.",
};

// The moment after sending. The Relatch mark latches shut as it arrives (its own "done" settle: the
// message is in), two soft rings travel out from it, and a warm light (the ambient background's own
// tone) blooms behind it. Then the words rise in one after another: a thank-you by first name, who has
// the message now, a line answering its topic, and the message itself quoted back, so the person sees
// what reached us. About 1.2s in all; nothing waits on it (the buttons work as soon as they show).
function Received({ email, name, topic, message, backLabel, onBack, onAgain }: { email: string; name: string; topic: Topic; message: string; backLabel: string; onBack: () => void; onAgain: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const first = name.trim().split(/\s+/)[0];
  const topicLabel = TOPICS.find(([t]) => t === topic)![1];

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || calm()) return;
    el.animate([
      { opacity: 0, transform: 'translateY(18px) scale(0.97)', filter: 'blur(12px)' },
      { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
    ], { duration: 760, easing: OUT });
    el.querySelector('[data-mark-wrap]')?.animate([
      { opacity: 0, transform: 'scale(0.55)', filter: 'blur(6px) drop-shadow(0 0 0px rgba(255,255,255,0))' },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0px) drop-shadow(0 0 22px rgba(255,255,255,0.45))', offset: 0.4 },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0px) drop-shadow(0 0 8px rgba(255,255,255,0.14))' },
    ], { duration: 1500, easing: OUT, fill: 'forwards' });
    el.querySelectorAll('[data-ring]').forEach((r, i) => r.animate([
      { opacity: 0.45, transform: 'scale(0.7)' },
      { opacity: 0, transform: 'scale(3.2)' },
    ], { duration: 1300, delay: 300 + i * 200, easing: OUT }));
    el.querySelector('[data-warm]')?.animate([
      { opacity: 0, transform: 'scale(0.7)' },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: 1600, delay: 250, easing: OUT, fill: 'both' });
    el.querySelectorAll('[data-in]').forEach((n, i) => n.animate([
      { opacity: 0, transform: 'translateY(10px)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' },
    ], { duration: 620, delay: 420 + i * 90, easing: OUT, fill: 'backwards' }));
  }, []);

  return (
    <div ref={root} role="status" aria-live="polite" className="relative isolate flex flex-col items-center overflow-hidden rounded-[24px] border border-line bg-ink-1 px-6 pb-10 pt-12 text-center sm:px-10">
      <div data-warm aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-190px] -z-10 -ml-[290px] size-[580px] rounded-full bg-[radial-gradient(closest-side,rgb(255_244_230/0.11),transparent)]" />
      <div className="relative grid size-16 place-items-center">
        <span data-ring aria-hidden="true" className="absolute inset-0 rounded-full border border-white/40 opacity-0" />
        <span data-ring aria-hidden="true" className="absolute inset-0 rounded-full border border-white/25 opacity-0" />
        <span data-mark-wrap className="relative"><RelatchMark state="done" size={52} className="text-fg" /></span>
      </div>
      <h2 data-in className="mt-7 text-[clamp(24px,3.2vw,30px)] font-semibold tracking-[-0.03em] text-fg">{first ? `Thank you, ${first}.` : 'Thank you for writing to us.'}</h2>
      <p data-in className="mt-3 max-w-[44ch] text-[15.5px] leading-relaxed text-fg-2">Your message is with the Relatch team. We read every one ourselves, and we'll reply to <span className="text-fg">{email}</span>.</p>
      <p data-in className="mt-2 max-w-[44ch] text-[14.5px] leading-relaxed text-fg-3">{THANKS[topic]}</p>
      <figure data-in className="mt-7 w-full max-w-[460px] rounded-2xl border border-line bg-white/[0.02] px-4 py-3.5 text-left">
        <figcaption className="flex items-center justify-between gap-3 text-[12.5px] text-fg-3">
          <span>What you sent</span>
          <span className="truncate rounded-full border border-line-2 px-2 py-px text-fg-2">{topicLabel}</span>
        </figcaption>
        <blockquote className="mt-2 line-clamp-3 whitespace-pre-line text-[14px] leading-relaxed text-fg-2 [overflow-wrap:anywhere]">{message}</blockquote>
      </figure>
      <div data-in className="mt-8 flex flex-wrap justify-center gap-2.5">
        <button onClick={onBack} className={cn('inline-flex h-10 items-center rounded-full bg-white px-5 text-[14px] font-medium text-black transition-colors hover:bg-white/90 active:scale-[0.98]', ring)}>{backLabel}</button>
        <button onClick={onAgain} className={cn('inline-flex h-10 items-center rounded-full px-4 text-[14px] text-fg-2 transition-colors hover:text-fg', ring)}>Send another</button>
      </div>
    </div>
  );
}
const field = 'mt-1.5 w-full rounded-xl border bg-white/[0.03] px-3.5 text-[14.5px] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-white/30';
const label = 'text-[13px] font-medium text-fg';

export function ContactPage({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const { user, isSignedIn } = useUser();
  const [email, setEmail] = useState(() => user?.primaryEmailAddress?.emailAddress ?? '');
  const [name, setName] = useState(() => user?.fullName ?? '');
  const [topic, setTopic] = useState<Topic>('question');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const bot = useRef<HTMLInputElement>(null);
  const emailEl = useRef<HTMLInputElement>(null);
  const messageEl = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const formBox = useRef<HTMLDivElement>(null);

  // Signed in, the reply address and name are filled in, also when Clerk finishes loading after the page
  // opened. Never over something already typed.
  useEffect(() => {
    const e = user?.primaryEmailAddress?.emailAddress;
    if (e) setEmail((v) => v || e);
    if (user?.fullName) setName((v) => v || user.fullName!);
  }, [user]);

  const emailError = !email.trim() ? 'Your email, so we can reply.' : !EMAIL_REGEX.test(email.trim()) ? "That email doesn't look right." : null;
  const messageError = message.trim().length < 10 ? 'Tell us a little more (at least 10 characters).' : null;

  // The form arrives softly on the page, and again after "Send another". Received animates itself.
  const sent = state === 'sent';
  useLayoutEffect(() => {
    if (sent || !card.current || calm()) return;
    card.current.animate([{ opacity: 0, transform: 'translateY(12px)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }], { duration: 520, easing: OUT });
  }, [sent]);

  // Sent: the form blurs away first, then the thank-you takes its place at the top of the page.
  const finish = async () => {
    const el = formBox.current;
    if (el && !calm()) {
      await el.animate([
        { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-8px) scale(0.985)', filter: 'blur(8px)' },
      ], { duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished.catch(() => {});
    }
    window.scrollTo({ top: 0 });
    setState('sent');
  };

  const send = async () => {
    setTried(true);
    if (emailError) { emailEl.current?.focus(); return; }
    if (messageError) { messageEl.current?.focus(); return; }
    if (state === 'sending') return;
    // A bot ticked the honeypot: it is told the message went, and nothing is sent.
    if (bot.current?.checked) { await finish(); return; }
    setState('sending');
    const topicLabel = TOPICS.find(([t]) => t === topic)![1];
    const body = new URLSearchParams({
      access_key: CONTACT_KEY,
      subject: `Relatch: ${topicLabel}${name.trim() ? ` from ${name.trim()}` : ''}`,
      from_name: 'Relatch contact form',
      email: email.trim(),
      replyto: email.trim(),
      name: name.trim(),
      topic: topicLabel,
      message: message.trim(),
      account: isSignedIn ? 'signed in' : 'not signed in',
    });
    try {
      const res = await fetch(SPLITFORMS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success !== false) await finish(); else setState('failed');
    } catch {
      setState('failed');
    }
  };

  const again = () => { setMessage(''); setTried(false); setState('idle'); };

  return (
    <div className="relative min-h-dvh">
      <header className="chrome-x sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink/75 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={onBack} aria-label={backLabel} title={backLabel} className={cn('-ml-2 grid size-9 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg', ring)}><ArrowLeftIcon size={18} /></button>
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Contact</h1>
      </header>

      <main className="mx-auto w-full max-w-[600px] px-4 pb-24 pt-10 sm:px-6 sm:pt-12">
        <div ref={card}>
          {sent ? (
            <Received email={email.trim()} name={name} topic={topic} message={message.trim()} backLabel={backLabel} onBack={onBack} onAgain={again} />
          ) : (<div ref={formBox}>
            <h2 className="text-[clamp(28px,4vw,36px)] font-semibold tracking-[-0.035em] text-fg">Get in touch</h2>
            <p className="mt-2 max-w-[48ch] text-[15.5px] leading-relaxed text-fg-2">Questions, a skill that came out wrong, feedback or partnerships. Every message is read by a person, and we reply by email.</p>

            {/* Enter in a one-line field sends; in the message, Ctrl/Cmd+Enter does (Enter is a new line). */}
            <div className="mt-8 space-y-5" onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              const t = e.target as HTMLElement;
              if (t instanceof HTMLInputElement && t.type !== 'checkbox') { e.preventDefault(); void send(); }
              else if (t instanceof HTMLTextAreaElement && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
            }}>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className={label}>Email</span>
                  <input ref={emailEl} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value.slice(0, 254))} placeholder="you@company.com" aria-invalid={tried && !!emailError} aria-describedby="contact-email-err" className={cn(field, 'h-11', tried && emailError ? 'border-[#e5484d]/60' : 'border-line-2')} />
                  {tried && emailError && <span id="contact-email-err" className="mt-1.5 block text-[12.5px] text-[#ff6369]">{emailError}</span>}
                </label>
                <label className="block">
                  <span className={label}>Name <span className="font-normal text-fg-3">(optional)</span></span>
                  <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} placeholder="Your name" className={cn(field, 'h-11 border-line-2')} />
                </label>
              </div>

              <div role="radiogroup" aria-label="What it's about">
                <span className={label}>What it's about</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TOPICS.map(([t, text]) => (
                    <button key={t} type="button" role="radio" aria-checked={topic === t} onClick={() => setTopic(t)} className={cn('h-9 rounded-full border px-3.5 text-[13.5px] transition-colors', ring, topic === t ? 'border-white/30 bg-white/[0.1] text-fg' : 'border-line-2 text-fg-2 hover:bg-white/[0.04] hover:text-fg')}>{text}</button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className={label}>Message</span>
                <textarea ref={messageEl} value={message} onChange={(e) => setMessage(e.target.value.slice(0, MAX))} rows={6} placeholder={TOPICS.find(([t]) => t === topic)![2]} aria-invalid={tried && !!messageError} aria-describedby="contact-msg-err" className={cn(field, 'scroll-thin block max-h-[50dvh] min-h-[150px] resize-none py-3 leading-relaxed [field-sizing:content]', tried && messageError ? 'border-[#e5484d]/60' : 'border-line-2')} />
                <span className="mt-1.5 flex items-start justify-between gap-3 text-[12.5px]">
                  <span id="contact-msg-err" className="text-[#ff6369]">{tried && messageError}</span>
                  {message.length > MAX - 1000 && <span className="shrink-0 tabular-nums text-fg-3">{message.length.toLocaleString()} / {MAX.toLocaleString()}</span>}
                </span>
              </label>

              {/* The honeypot: hidden from people and from screen readers, so only a bot fills it. */}
              <input ref={bot} type="checkbox" name="botcheck" tabIndex={-1} aria-hidden="true" autoComplete="off" className="hidden" />

              {state === 'failed' && (
                <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-[13.5px] leading-snug text-amber-100">
                  <WarningCircleIcon size={17} className="mt-px shrink-0" />
                  <span>It didn't send. Try again, or email us at <a href={`mailto:${CONTACT_EMAIL}`} className="underline decoration-amber-100/40 underline-offset-4 hover:decoration-amber-100">{CONTACT_EMAIL}</a>. Your message is still here.</span>
                </p>
              )}

              {/* On a phone the button runs full width, with the email line under it. */}
              <div className="flex flex-col-reverse gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-center text-[13px] text-fg-3 sm:text-left">Prefer email? <a href={`mailto:${CONTACT_EMAIL}`} className="text-fg-2 underline decoration-white/20 underline-offset-4 hover:text-fg">{CONTACT_EMAIL}</a></p>
                <button type="button" onClick={() => void send()} disabled={state === 'sending'} className={cn('inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-[14px] font-medium text-black transition-[background-color,opacity,transform] hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 sm:h-10', ring)}>
                  <PaperPlaneTiltIcon size={16} weight="bold" />{state === 'sending' ? 'Sending…' : 'Send message'}
                </button>
              </div>
            </div>
          </div>)}
        </div>
      </main>
    </div>
  );
}
