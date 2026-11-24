// "Relatch in your agent - coming soon" (2026-11-03, Manas): what Settings opens where the API platform used
// to be. The API platform is dropped, and making skills from inside Claude, Codex and other agents (the
// MCP server) is parked until after V3 (vault "Relatch MCP Server - Future Plan"), so this page promises
// the idea only: no API, no protocol, no date. A page of its own like Contact: no sidebar, one way back.
// Motion is the app's own: the headline reveals word by word like the home page hero (Start.tsx, SplitText;
// it had a "Coming soon" pill above it until Manas removed it the same day), the rest resolves out of a
// blur like the reasoning steps (Thinking.tsx), the
// Relatch mark breathes at the centre, and the agents' logos drift round it on a slow orbit, each in the
// same ringed white circle as the install walkthrough's header (AgentScene.tsx), turning back so they
// stay upright. Reduced motion: everything is simply there, still.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import SplitText from '@/components/SplitText';
import { RelatchMark } from './RelatchMark';
import { ClaudeLogo, CodexLogo } from './logos';
import { AGENTS } from './AgentScene';
import { cn } from '@/lib/utils';

const ring = 'focus-visible:outline-2 focus-visible:outline-white/60';

// Claude and Codex first, then the agents the Agents tab names; each with its optical size (AgentScene).
const ORBIT: { name: string; icon: ReactNode }[] = [
  { name: 'Claude', icon: <ClaudeLogo size={17} /> },
  { name: 'Codex', icon: <CodexLogo size={18} /> },
  ...AGENTS.map(([name, src, k]) => ({ name, icon: <img src={src} alt="" draggable={false} className="size-[20px] max-w-none" style={{ transform: `scale(${k})` }} /> })),
];

export function ComingSoon({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const q = gsap.utils.selector(el);
    const ctx = gsap.context(() => {
      // The orbit: the ring turns once a minute; each logo turns back by the same amount, so it stays upright.
      const spin = { duration: 60, ease: 'none', repeat: -1 };
      gsap.to(q('[data-orbit]'), { rotate: 360, ...spin });
      gsap.to(q('[data-sat]'), { rotate: -360, ...spin });
      // Arrival: the logos pop onto the ring one after another while the text resolves out of a blur.
      gsap.from(q('[data-pop]'), { opacity: 0, scale: 0.55, filter: 'blur(6px)', duration: 0.7, ease: 'back.out(1.7)', stagger: 0.08, delay: 0.15 });
      gsap.from(q('[data-in]'), { opacity: 0, y: 8, filter: 'blur(6px)', duration: 0.55, ease: 'expo.out', stagger: 0.18, delay: 0.6, clearProps: 'filter' });
      // A slow breath on the ring's glow, so the still page is never quite still.
      gsap.to(q('[data-glow]'), { opacity: 0.9, scale: 1.06, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <header className="chrome-x sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink/75 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={onBack} aria-label={backLabel} title={backLabel} className={cn('-ml-2 grid size-9 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg', ring)}><ArrowLeftIcon size={18} /></button>
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Relatch in your agent</h1>
      </header>

      <main ref={root} className="mx-auto flex w-full max-w-[600px] flex-col items-center px-4 pb-24 pt-10 text-center sm:px-6 sm:pt-12">
        {/* The orbit: the mark at the centre, the agents on a ring round it. Decorative only. */}
        <div aria-hidden="true" className="relative size-[min(78vw,300px,40dvh)]">
          <div data-glow className="absolute inset-[18%] rounded-full bg-white/[0.06] opacity-60 blur-2xl" />
          <div className="absolute inset-0 rounded-full border border-line" />
          <div className="absolute inset-[22%] rounded-full border border-dashed border-white/[0.07]" />
          <div className="absolute inset-0 grid place-items-center"><RelatchMark state="thinking" size={58} className="text-fg" /></div>
          <div data-orbit className="absolute inset-0">
            {ORBIT.map((a, i) => {
              const t = (i / ORBIT.length) * Math.PI * 2 - Math.PI / 2;
              return (
                <div key={a.name} className="absolute" style={{ left: `${50 + 50 * Math.cos(t)}%`, top: `${50 + 50 * Math.sin(t)}%`, transform: 'translate(-50%, -50%)' }}>
                  <div data-sat>
                    <span data-pop className="grid size-[38px] place-items-center rounded-full bg-white ring-1 ring-white/20 ring-offset-2 ring-offset-ink shadow-[0_8px_24px_rgb(0_0_0/0.5)]" title={a.name}>{a.icon}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* The home page hero's own reveal (Start.tsx): word by word out of a blur. No "Coming soon" pill
            (Manas, 2026-11-03): the header and the line below already say it. */}
        <SplitText
          tag="h2"
          text="Relatch, inside your agent"
          className="mt-10 text-[clamp(28px,4vw,36px)] font-semibold leading-[1.1] tracking-[-0.035em] text-fg"
          splitType="words"
          delay={70}
          duration={1.1}
          ease="expo.out"
          from={{ opacity: 0, y: 26, filter: 'blur(10px)' }}
          to={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          threshold={0}
          rootMargin="0px"
        />
        <p data-in className="mt-3 max-w-[46ch] text-[15.5px] leading-relaxed text-fg-2">Make a skill and install it without leaving Claude, Codex or the agent you already use. We're building it now.</p>
        <button data-in type="button" onClick={onBack} className={cn('mt-8 rounded-full border border-line-2 px-5 py-2 text-[14px] text-fg transition-colors hover:bg-white/[0.06]', ring)}>{backLabel}</button>
      </main>
    </div>
  );
}
