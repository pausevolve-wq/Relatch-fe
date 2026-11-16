// The first screen (draft-1 layout, resized): the intro, the Claude/Codex/Agents switch, one drop zone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileTextIcon } from '@phosphor-icons/react';
import SplitText from '@/components/SplitText';
import { RelatchMark } from './RelatchMark';
import { TARGET_NAME, TargetLogo } from './logos';
import type { Target } from './skillExport';
import { SlidingThumb } from './SlidingThumb';
import { introPending, runHeroIntro } from './heroIntro';
import { cn } from '@/lib/utils';
import openclawIcon from './agent-icons/openclaw.png';
import grokIcon from './agent-icons/grok.png';
import hermesIcon from './agent-icons/hermes.png';
import openaiDotsIcon from './agent-icons/openai-dots.png';

// Exactly the engine's SUPPORTED_EXTENSIONS (src/engine/core.ts). The picker must not offer a file the engine
// then refuses: `.tsx` used to be here and every .tsx failed with "Unsupported file type".
export const ACCEPT = '.pdf,.docx,.doc,.txt,.md,.json,.yaml,.yml,.csv,.html,.htm,.xml,.js,.ts,.py,.rb,.go,.rs,.toml,.log';

// The newly selected side resolves out of a soft blur as the thumb arrives under it.
const unblur = (b: HTMLElement) => b.animate([{ filter: 'blur(7px)' }, { filter: 'blur(0px)' }], { duration: 450, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });

// 2026-11-02 (Manas's design): picking Agents pops the agents it works with out of the word "Agents",
// in a row across the white thumb just as it lands, then pulls them back into the word in an instant.
// The Agents mark and the word step aside while they are out (the button is too small to share);
// both come back as the icons return. The PNGs are Manas's
// (Grok bot cut out of its baked-in checkerboard); they sit in the DOM from the start so the first
// burst never waits for an image.
// Each icon's own scale evens out how big they LOOK: the drawings fill their squares differently (share of
// the square inked: Grok's full ball 0.66, OpenClaw 0.48, Hermes 0.46, OpenAI 0.52), so each is sized to
// the same inked area, sqrt(0.49 / its share). Without it the Grok ball read as the biggest of the four.
const AGENT_ICONS: [string, string, number][] = [['OpenClaw', openclawIcon, 1], ['Grok bot', grokIcon, 0.86], ['Hermes Agent', hermesIcon, 1.03], ['OpenAI', openaiDotsIcon, 0.97]];
const BURST_MS = 1050;
// No fixed delay (2026-11-10, Manas): a tap that moves the thumb starts the burst when the thumb arrives
// (SlidingThumb onArrive). The old 140ms started it 134ms before the thumb reached Agents.
const BURST_DELAY = 0;
// The word "Agents" leaves and returns this fast, so it never shows half see-through (grey) on the thumb.
const WORD_SNAP_MS = 40;

function burst(btn: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const word = btn.querySelector<HTMLElement>('[data-word]');
  const text = btn.querySelector<HTMLElement>('[data-text]');
  const logo = btn.querySelector<HTMLElement>('[data-logo]');
  const icons = [...btn.querySelectorAll<HTMLElement>('[data-pop]')];
  if (!word || !text || !logo || !icons.length) return;
  // Measured, not assumed: where the word's centre is, and where the button is, right now.
  const b = btn.getBoundingClientRect();
  const w = word.getBoundingClientRect();
  const ox = w.left + w.width / 2;
  const oy = w.top + w.height / 2;
  // A burst still running (switched away and straight back) is cancelled before this one starts.
  for (const el of [text, logo, ...icons]) el.getAnimations().forEach((a) => a.cancel());
  // The icons stay on the white thumb (the button's own box), so a black one like Hermes reads too; the
  // word fades out completely while they are out (a see-through word behind them looked unfinished)
  // and comes back as they return into it.
  // 2026-11-10 (Manas: no blank moment): the icons start popping the moment the word starts going; they
  // used to wait until it was gone, and for a frame or two the pill was nearly empty (brightest part 0.24).
  // Now it never drops below 0.52. The end is unchanged on purpose: bringing the word back earlier (the
  // full overlap) drew it across the icons while they were still spread out, and the logo already covers
  // the end (the pill is never empty there).
  // 2026-11-10 (Manas: the word read grey on the white thumb, Claude and Codex go straight to black): the word
  // is black all along, but its fades (63ms out, ~95ms back in, starting ~60ms after the logo was already back)
  // showed it see-through, i.e. grey. Now it is either fully there or gone: the opacity jumps (a 40ms fade still
  // drew two grey frames at 60fps), and only the small scale moves, WORD_SNAP_MS each way.
  const snap = WORD_SNAP_MS / BURST_MS;
  const jump = 'steps(1, start)';
  text.animate([
    { opacity: 1, easing: jump }, // gone at once, before the icons are big enough to cross it
    { opacity: 0, offset: 0.9, easing: jump }, // back at once, as the last icon is in
    { opacity: 1, offset: 0.9 + snap },
    { opacity: 1 },
  ], { duration: BURST_MS, delay: BURST_DELAY });
  text.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(0.85)', offset: snap },
    { transform: 'scale(0.85)', offset: 0.9, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    { transform: 'scale(1)', offset: 0.9 + snap },
    { transform: 'scale(1)' },
  ], { duration: BURST_MS, delay: BURST_DELAY });
  logo.animate([
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(0.5)', offset: 0.1 },
    { opacity: 0, transform: 'scale(0.5)', offset: 0.8, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    { opacity: 1, transform: 'scale(1.15)', offset: 0.9 },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: BURST_MS, delay: BURST_DELAY });
  const at = (x: number, y: number, r: number, s: number) => `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`;
  const size = icons[0].offsetWidth || 20;
  const gap = Math.max(2, Math.min(8, (b.width - 12 - size * icons.length) / Math.max(1, icons.length - 1)));
  const rowLeft = b.left + b.width / 2 - ((size + gap) * (icons.length - 1)) / 2;
  icons.forEach((el, i) => {
    const f = icons.length === 1 ? 0.5 : i / (icons.length - 1);
    const k = Number(el.dataset.k) || 1; // its optical size (AGENT_ICONS)
    // A row across the middle of the button, on a slight smile, tilted outwards at the ends.
    const x = rowLeft + i * (size + gap) - ox;
    const y = b.top + b.height / 2 - oy + Math.abs(f - 0.5) * 4 - 1;
    const r = (f - 0.5) * 18;
    el.animate([
      { opacity: 0, transform: at(0, 0, 0, 0.2), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }, // pop out as the word starts going, with overshoot
      { opacity: 1, transform: at(x, y, r, k), offset: 0.36, easing: 'ease-in-out' },
      { opacity: 1, transform: at(x, y - 2, r, k), offset: 0.62, easing: 'cubic-bezier(0.55, 0, 0.9, 0.3)' }, // then back in, fast
      { opacity: 0, transform: at(0, 0, 0, 0.2), offset: 0.8 },
      { opacity: 0, transform: at(0, 0, 0, 0.2) },
    ], { duration: BURST_MS, delay: BURST_DELAY + i * 30 });
  });
}

const RETRACT_MS = 160;

/** Leaving Agents mid-burst (2026-11-06, Manas: the burst kept playing after a quick switch to Claude or
 *  Codex, whose own logo animations stop with their .is-tapped class). The burst is Web Animations, which
 *  nothing stopped. Now: every part goes back from wherever it is - icons into the word, the word and the
 *  mark back in - in a short retract instead of a jump. */
function stopBurst(btn: HTMLElement) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const el of btn.querySelectorAll<HTMLElement>('[data-text], [data-logo], [data-pop]')) {
    if (!el.getAnimations().length) continue;
    const now = getComputedStyle(el);
    const from = { opacity: now.opacity, transform: now.transform };
    el.getAnimations().forEach((a) => a.cancel());
    if (reduced) continue;
    const rest = getComputedStyle(el); // its resting look once the burst is cancelled
    el.animate([from, { opacity: rest.opacity, transform: rest.transform }], { duration: RETRACT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
  }
}

export function TargetToggle({ target, onChange, disabled }: { target: Target; onChange: (t: Target) => void; disabled?: boolean }) {
  // The logo animation plays on tap via .is-tapped (touch too), not on hover (Manas, 2026-11-10).
  const [tapped, setTapped] = useState<Target | null>(null);
  const agentsBtn = useRef<HTMLButtonElement>(null);
  const tapTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);
  // The burst plays only when a tap slides the white thumb over to Agents, and starts as it arrives (B).
  // A tap on Agents already selected plays nothing (Manas, 2026-11-10: reversed the replay-on-every-tap
  // change), nor does one while the thumb is still on its way. Only a tap starts it, never a change from Settings.
  // Claude/Codex: their logos play on tap, never on hover (Manas, 2026-11-10: hover removed for all three).
  const waiting = useRef(false);
  const arrived = (b: HTMLElement) => {
    const go = waiting.current && b === agentsBtn.current;
    waiting.current = false;
    if (go) burst(b);
  };
  const pick = (t: Target) => {
    if (t === 'agents') { if (target !== 'agents') waiting.current = true; }
    else { waiting.current = false; if (agentsBtn.current) stopBurst(agentsBtn.current); }
    onChange(t);
    setTapped(t);
    window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => setTapped((x) => (x === t ? null : x)), 1500);
  };

  // The white thumb sits behind the selected button and glides between the two, with a motion blur
  // (SlidingThumb). The labels and logos sit above it and keep their own animations.
  return (
    <div role="radiogroup" aria-label="Build the skill for" className="relative inline-flex rounded-full border border-line bg-ink-2 p-1">
      <SlidingThumb value={target} className="inset-y-1 bg-white" onGlide={unblur} onArrive={arrived} />
      {(['claude', 'codex', 'agents'] as const).map((t) => (
        <button
          key={t}
          ref={t === 'agents' ? agentsBtn : undefined}
          role="radio"
          aria-checked={target === t}
          disabled={disabled}
          onClick={() => pick(t)}
          className={cn(
            'agent-btn relative z-[1] inline-flex items-center gap-2.5 rounded-full py-2 pl-3.5 pr-5 text-[15px] font-medium transition-[color] duration-200 focus-visible:outline-2 focus-visible:outline-white/60 disabled:cursor-not-allowed',
            // Phones (2026-11-06): at 341px the switch overflowed every screen under ~345px (home and How to
            // install). Under 400px it tightens; under 340px the logos step aside and the names stay.
            'max-[399px]:gap-2 max-[399px]:pl-3 max-[399px]:pr-3.5 max-[399px]:text-[14px] max-[339px]:px-3 max-[339px]:[&>:first-child]:hidden',
            tapped === t && 'is-tapped',
            target === t ? 'text-black' : 'text-fg-2 hover:text-fg',
          )}
        >
          {t === 'agents' ? (
            <>
              <span data-logo className="inline-flex"><TargetLogo target={t} size={20} /></span>
              {/* The burst's origin is the word's centre; the icons wait there, invisible, until picked. */}
              <span data-word className="relative">
                <span data-text className="inline-block">{TARGET_NAME[t]}</span>
                <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2">
                  {AGENT_ICONS.map(([alt, src, k]) => (
                    <img key={alt} data-pop data-k={k} src={src} alt="" width={20} height={20} draggable={false} className="absolute left-0 top-0 size-[20px] max-w-none opacity-0 drop-shadow-[0_1px_2px_rgb(0_0_0/0.28)]" style={{ transform: 'translate(-50%, -50%) scale(0.2)' }} />
                  ))}
                </span>
              </span>
            </>
          ) : (
            <>
              <TargetLogo target={t} size={20} />
              {TARGET_NAME[t]}
            </>
          )}
        </button>
      ))}
    </div>
  );
}

// `compact` is the same drop zone inside the workspace ("New skill"): no headline pitch, no first-load
// intro, no sample and no "free" line, because the person already knows what Relatch does.
export function Start({ target, onTarget, onFiles, onSample, compact = false }: { target: Target; onTarget: (t: Target) => void; onFiles: (f: File[]) => void; onSample: () => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const scope = useRef<HTMLElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLParagraphElement>(null);
  const sampleRow = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  // False only while the first-load intro is waiting for its cue; it releases the headline's word stagger.
  const [go, setGo] = useState(() => compact || !introPending());

  useLayoutEffect(() => {
    if (compact) return;
    const hero = scope.current?.querySelector<HTMLElement>('h1');
    const pill = scope.current?.querySelector<HTMLElement>('[role="radiogroup"]');
    if (!hero || !pill || !drop.current) { setGo(true); return; }
    const fades = [sub.current, sampleRow.current].filter((el): el is HTMLParagraphElement | HTMLDivElement => !!el);
    return runHeroIntro({ hero, pill, drop: drop.current, fades, onStart: () => setGo(true) });
  }, []);
  const spot = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
  };

  return (
    // `my-auto` centres the block in its pane (a little above true centre, by the heavier bottom padding).
    // There is no bar above or below it, so the padding is real open space, not a gap between two lines.
    // The dvh terms reach their full value by an 867px-tall window and ease off under that: a 125% laptop
    // (about 1534x689) keeps the whole block on screen without the type being crushed.
    <section ref={scope} className="mx-auto my-auto flex w-full max-w-[960px] flex-col items-center px-4 pb-[clamp(32px,8.5dvh,112px)] pt-[clamp(24px,6.5dvh,80px)] text-center">
      <SplitText
        tag="h1"
        text={compact ? 'New skill' : 'Turn any document into a skill.'}
        className={compact
          ? 'text-[clamp(28px,3vw,36px)] font-semibold leading-[1.05] tracking-[-0.04em] text-fg'
          : 'max-w-[13ch] text-[clamp(40px,min(5.6vw,8.4dvh),72px)] font-semibold leading-[1] tracking-[-0.045em] text-fg'}
        splitType="words"
        delay={70}
        duration={1.1}
        ease="expo.out"
        from={{ opacity: 0, y: 26, filter: 'blur(10px)' }}
        to={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        threshold={0}
        rootMargin="0px"
        ready={go}
      />
      {/* One line from 768px up, so the taller drop zone below still fits a 125% laptop screen. */}
      {!compact && <p ref={sub} className="mt-[clamp(12px,2.3dvh,20px)] max-w-[40ch] text-balance text-[16.5px] leading-snug text-fg-2 md:max-w-none md:whitespace-nowrap">Relatch reads it, thinks it through, and writes a skill your AI follows every time.</p>}

      <div className="mt-[clamp(14px,calc(9dvh_-_46px),32px)]"><TargetToggle target={target} onChange={onTarget} /></div>

      <div
        ref={drop}
        role="button"
        tabIndex={0}
        aria-label="Drop a document, or press Enter to choose a file"
        data-ambient-origin
        onMouseMove={spot}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        // Only when the drag really leaves the zone: dragleave also fires on entering one of its children
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); const fs = Array.from(e.dataTransfer.files ?? []); if (fs.length) onFiles(fs); }}
        className={cn(
          // Narrower and taller than a strip: about 2.3:1 on a laptop, so it reads as a place to drop
          // something. The height follows the screen's, between 200px and 272px.
          'group relative mt-[clamp(12px,2.3dvh,20px)] flex min-h-[clamp(200px,calc(17dvh_+_124px),272px)] w-full max-w-[560px] cursor-pointer flex-col justify-center overflow-hidden rounded-[24px] border bg-gradient-to-b from-ink-2 to-ink px-6 py-[clamp(18px,calc(12dvh_-_60px),44px)] transition-[border-color,transform] duration-500 ease-out-expo focus-visible:outline-2 focus-visible:outline-white/60',
          over ? 'scale-[1.01] border-white/40' : 'border-line hover:border-line-2',
        )}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-64 w-[80%] rounded-full bg-white/[0.06] blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(380px_circle_at_var(--x,50%)_var(--y,50%),rgb(255_255_255/0.07),transparent_60%)]" />
        <div className="relative flex flex-col items-center">
          <RelatchMark state={over ? 'thinking' : 'idle'} size={48} className="text-fg" />
          <p className="mt-5 text-[20px] font-medium tracking-[-0.01em] text-fg">{over ? 'Let go to start' : 'Drop a document'}</p>
          <p className="mt-1.5 text-[14.5px] text-fg-2">or <span className="text-fg underline decoration-white/30 underline-offset-4 group-hover:decoration-white/70">choose a file</span></p>
          {/* Kinds of documents, led by "most work": examples, not a whitelist. A list of formats reads as
              "only these". The exact formats are spelled out only if a file is turned away (V3App). */}
          <p className="mt-4 text-balance text-[13px] text-fg-3">Most documents work: PDFs, Word, notes, code, data · up to 3 files, 20 MB each</p>
        </div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); e.target.value = ''; }} />
      </div>

      {/* Under the drop zone an app offers a way to start, not more copy: one sample to run, and the one
          fact that removes the hesitation. The Reads / Thinks / Writes strip that sat here repeated the
          line under the headline. */}
      {!compact && (
        <div ref={sampleRow} className="mt-[clamp(12px,2.3dvh,20px)] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13.5px]">
          <button onClick={onSample} className="relative inline-flex items-center gap-2 rounded-full border border-line bg-ink-2 py-1.5 pl-3 pr-3.5 text-fg-2 transition-colors hover:border-line-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60">
            <FileTextIcon size={15} />Try it with a sample
          </button>
          <span className="text-fg-3">Try it free, no sign-up</span>
        </div>
      )}
    </section>
  );
}
