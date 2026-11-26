// The one-question follow-up (Manas, 2026-11-26): after a signed-in person downloads or copies a skill, ask the
// thing we most need to know: did it work in Claude/Codex, and what was missing. The first-skill note
// (FeedbackNote.tsx) only reaches people without an account, and asks how it went in general.
//
// Where it goes: PostHog, as one event (`skill_feedback_sent`), via captureEvent. No form, no WebForms quota.
// Properties: worked (yes | partly | no | ''), answer (the free text, cut at ANSWER_MAX), action, target,
// session_id. Nothing from the document is sent: no skill or file names. Session replays mask the textarea
// (analytics.ts maskAllInputs), so the text only travels in the event, once, when they press Send.
// Shown at most once per browser once answered, and not again for 14 days after "Not now".
import { useState } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { readStorage } from '@/engine/core';
import { captureEvent } from '../analytics';
import { cn } from '@/lib/utils';

const KEY = 'relatch_v3_export_ask';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const ANSWER_MAX = 1000;

/** Due unless they already answered in this browser, or put it aside less than 14 days ago. Storage refused: not due. */
export function exportAskDue(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return true;
    if (v === 'sent') return false;
    const at = Number(v.replace('snoozed:', ''));
    return !Number.isFinite(at) || Date.now() - at > SNOOZE_MS;
  } catch { return false; }
}

const remember = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* nothing to remember with */ } };

const WORKED = [['yes', 'Worked'], ['partly', 'Partly'], ['no', "Didn't work"]] as const;
type Worked = (typeof WORKED)[number][0];

export function ExportAsk({ action, target, agent, onClose }: { action: 'download' | 'copy'; target: string; agent: string; onClose: () => void }) {
  const [worked, setWorked] = useState<Worked | ''>('');
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const where = target === 'agents' ? 'your agent' : agent;

  const send = () => {
    const answer = text.trim().slice(0, ANSWER_MAX);
    if (!worked && !answer) return;
    captureEvent('skill_feedback_sent', { worked, answer, has_answer: !!answer, action, target, session_id: readStorage('rl_session_id') });
    remember('sent');
    setSent(true);
    window.setTimeout(onClose, 2200);
  };
  const dismiss = () => {
    captureEvent('skill_feedback_dismissed', { action, target, session_id: readStorage('rl_session_id') });
    remember(`snoozed:${Date.now()}`);
    onClose();
  };

  if (sent) return <p role="status" className="mt-3 flex items-center gap-2 text-[13px] text-fg-2"><CheckIcon size={15} weight="bold" />Thanks, that helps.</p>;

  return (
    <div role="group" aria-label="Quick question" className="mt-3 rounded-2xl border border-line-2 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-medium text-fg">Did this skill file work in {where}? What was missing?</p>
        <button type="button" onClick={dismiss} aria-label="Not now" className="-m-1 shrink-0 rounded-full p-1 text-fg-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"><XIcon size={14} /></button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {WORKED.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={worked === v} onClick={() => setWorked(worked === v ? '' : v)}
            className={cn('h-8 rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-white/60', worked === v ? 'border-white/60 bg-white/10 text-fg' : 'border-line-2 text-fg-2 hover:bg-white/[0.06] hover:text-fg')}>{label}</button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={ANSWER_MAX} rows={2} placeholder="Optional: what did it miss or get wrong?"
        className="mt-3 block w-full resize-none rounded-xl border border-line-2 bg-transparent px-3 py-2 text-[14px] text-fg outline-none placeholder:text-fg-3 focus:border-white/40" />
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={send} disabled={!worked && !text.trim()} className="inline-flex h-8 items-center rounded-full bg-white px-4 text-[13px] font-medium text-black transition-opacity hover:bg-white/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/60">Send</button>
        <button type="button" onClick={dismiss} className="text-[13px] text-fg-3 hover:text-fg">Not now</button>
      </div>
    </div>
  );
}
