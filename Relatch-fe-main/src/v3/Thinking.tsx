// The reasoning panel. While Relatch works it shows the live mark, a shimmering "Thinking" label,
// a running timer and the steps as they happen. Afterwards it folds into "Thought for 6.3s",
// which opens back up to show what Relatch did.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { CheckIcon, WarningCircleIcon, CaretDownIcon } from '@phosphor-icons/react';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import { RelatchMark } from './RelatchMark';
import type { Step } from './useSkillJob';
import { cn } from '@/lib/utils';

function StepRow({ step }: { step: Step }) {
  return (
    <li data-step className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
      <span className="mt-[3px] grid size-5 place-items-center">
        {step.status === 'active' && <span className="size-1.5 animate-pulse rounded-full bg-fg" />}
        {step.status === 'done' && <CheckIcon size={15} weight="bold" className="text-fg-2" />}
        {step.status === 'warn' && <WarningCircleIcon size={16} weight="bold" className="text-amber-300" />}
      </span>
      <div className="min-w-0">
        {step.status === 'active'
          ? <AnimatedShinyText className="mx-0 max-w-none text-[15px] font-medium text-fg-2/80 dark:text-fg-2/80" shimmerWidth={140}>{step.label}</AnimatedShinyText>
          : <p className="text-[15px] font-medium text-fg">{step.label}</p>}
        {step.detail && <p className="mt-0.5 text-[13.5px] text-fg-2">{step.detail}</p>}
      </div>
    </li>
  );
}

// The live label. It walks through what Relatch is doing, each word dissolving into the next.
const THINK_WORDS = ['Thinking', 'Analyzing', 'Building', 'Writing', 'Polishing'];

function ThinkLabel() {
  const box = useRef<HTMLSpanElement>(null);
  const [word, setWord] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      const el = box.current;
      if (!el) return;
      const out = el.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(5px)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' });
      out.finished.then(() => {
        if (!el.isConnected) return;
        // Swap the word while it is still invisible, in the same task, so the old one never flashes back.
        flushSync(() => setWord((w) => (w + 1) % THINK_WORDS.length));
        out.cancel();
        el.animate([{ opacity: 0, filter: 'blur(5px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 260, easing: 'ease-out' });
      }, () => {});
    }, 1200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span ref={box}>
      <AnimatedShinyText className="think-label mx-0 max-w-none text-[20px] font-medium tracking-[-0.01em]" shimmerWidth={120}>{THINK_WORDS[word]}</AnimatedShinyText>
    </span>
  );
}

// `files`: the documents of a skill built from several, each with where it is, shown above the steps
// (which follow the one being written). `footer`: an action beside the timing note (adding a document).
export function Thinking({ steps, running, seconds, className, files, footer }: { steps: Step[]; running: boolean; seconds?: number; className?: string; files?: { name: string; status: 'thinking' | 'done' | 'error' }[]; footer?: ReactNode }) {
  const list = useRef<HTMLOListElement>(null);
  const shown = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t0 = performance.now();
    const id = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => window.clearInterval(id);
  }, [running]);

  // New steps blur in one after another, so a batch that arrives together still reads in order.
  useGSAP(() => {
    const rows = list.current ? Array.from(list.current.querySelectorAll('[data-step]')) : [];
    const fresh = rows.slice(shown.current);
    shown.current = rows.length;
    if (!fresh.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.from(fresh, { opacity: 0, y: 8, filter: 'blur(6px)', duration: 0.55, ease: 'expo.out', stagger: 0.18 });
  }, { dependencies: [steps.length, open] });

  if (!running) {
    return (
      <div className="rounded-2xl border border-line bg-ink-1/60">
        <button onClick={() => { shown.current = 0; setOpen((o) => !o); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] text-fg-2 transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60">
          <RelatchMark state="done" size={18} className="text-fg" />
          <span>Thought for {seconds?.toFixed(1)}s</span>
          <CaretDownIcon size={14} className={cn('ml-auto transition-transform duration-300', open && 'rotate-180')} />
        </button>
        {open && <ol ref={list} className="space-y-3 border-t border-line px-4 py-4">{steps.map((s) => <StepRow key={s.id} step={s} />)}</ol>}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col rounded-[28px] border border-line bg-ink-1 p-6 sm:p-8', className)}>
      <div className="flex items-center gap-4">
        <RelatchMark state="thinking" size={44} className="text-fg" />
        <ThinkLabel />
        <span className="ml-auto font-mono text-[13px] tabular-nums text-fg-3">{elapsed.toFixed(1)}s</span>
      </div>
      {files && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={i} className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]', f.status === 'error' ? 'border-amber-300/25 text-amber-100' : 'border-line-2 text-fg-2')}>
              {f.status === 'thinking' ? <span className="size-1.5 animate-pulse rounded-full bg-fg" /> : f.status === 'done' ? <CheckIcon size={12} weight="bold" /> : <WarningCircleIcon size={13} />}
              <span className="truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      )}
      <ol ref={list} className="mt-6 space-y-4">{steps.map((s) => <StepRow key={s.id} step={s} />)}</ol>
      {/* At least 32px between the last step and the rule, and any spare height of a tall card goes here
          too, keeping the footer at the bottom. (`lg:mt-auto` on the footer did the second job but threw
          away the first: with no spare height it came out as 0 and the last step sat on the rule.) */}
      <div aria-hidden="true" className="min-h-8 flex-1" />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line pt-5">
        <p className="text-[13.5px] leading-relaxed text-fg-3">Most skills are ready in 5 to 15 seconds. Long documents can take up to a minute.</p>
        {footer}
      </div>
    </div>
  );
}
