// "How to install" for an Agents skill (2026-11-03, Manas's brief): one walkthrough for every agent, not a
// video per agent. People already talk to their agent like a chat, so the scene is a chat: the downloaded
// ZIP is dropped in, "install this skill" is sent, and the agent installs it by itself. The header names
// the agent and keeps changing it (Hermes Agent, OpenClaw, OpenAI Dots, Muse, Grok Bot), so the scene is
// about any agent rather than one. The chat's look is deliberately its own - a cool slate messenger with
// bubbles on both sides and a mint send button - so it reads as neither the Claude app scene nor the
// Codex app scene in SetupScene.tsx. Cursor, Stage and FileChip are shared with that file.
// Revised the same day (Manas: the slate-and-mint looked vibe-coded, like WhatsApp's dark mode): only the
// app's own black, greys and white (v3.css tokens). The person's messages are white, like the app's own
// buttons; the agent's sit in bordered grey cards with no bubble tails; the send button is white. Still
// neither app's look: the Claude app is warm grey with a serif title, the Codex app has its purple send.
// The header's name now changes as a masked ticker with the logo cross-fading in a ringed circle.
import { useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle, type ComponentProps } from 'react';
import { gsap } from 'gsap';
import { TextPlugin } from 'gsap/TextPlugin';
import { ArrowCounterClockwiseIcon, ArrowUpIcon, CheckIcon, CircleNotchIcon, FileZipIcon, PaperclipIcon } from '@phosphor-icons/react';
import { AgentsLogo } from './logos';
import { Cursor, FileChip, Stage, type SetupHandle } from './SetupScene';
import { cn } from '@/lib/utils';
import openclawIcon from './agent-icons/openclaw.png';
import grokIcon from './agent-icons/grok.png';
import hermesIcon from './agent-icons/hermes.png';
import openaiDotsIcon from './agent-icons/openai-dots.png';
import museIcon from './agent-icons/muse.png';

gsap.registerPlugin(TextPlugin);

// The names the header cycles through, with their logos and each logo's optical size: scaled to the same
// inked area so none looks bigger than the rest (Grok's full ball 0.86), capped where a wide mark would
// leave the circle (Muse's M: equal area would be 1.34).
// Also shown orbiting on the "coming soon" page (ComingSoon.tsx).
export const AGENTS: [string, string, number][] = [['Hermes Agent', hermesIcon, 1.04], ['OpenClaw', openclawIcon, 1], ['OpenAI Dots', openaiDotsIcon, 0.97], ['Muse', museIcon, 1.12], ['Grok Bot', grokIcon, 0.86]];

// No agent is named in the steps: what to do is the same in all of them.
function stepsFor(file: string, real: boolean) {
  return [
    { t: 'Download the ZIP', d: real ? `It saves to your Downloads as ${file}` : 'It saves to your Downloads' },
    { t: "Open your agent's chat", d: 'In its app, on the web or in your terminal: wherever you talk to it' },
    { t: 'Drop the ZIP into the chat', d: 'Or attach it the way you attach any file' },
    { t: 'Send "install this skill"', d: 'If it asks to unpack files or run a command, allow it' },
    { t: 'It installs it, then uses it', d: 'Ask for something the skill covers: it picks it up by itself' },
  ];
}

export const AgentScene = forwardRef<SetupHandle, { file: string; skill: string; title: string; real: boolean }>(function AgentScene({ file, skill, title, real }, ref) {
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const scene = useRef<HTMLDivElement>(null);
  const spin = useRef<HTMLSpanElement>(null);
  useImperativeHandle(ref, () => ({ replay: () => setRun((r) => r + 1) }), []);
  const list = stepsFor(file, real);

  const replay = () => {
    setRun((r) => r + 1);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) spin.current?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-360deg)' }], { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  };

  useLayoutEffect(() => {
    const el = scene.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = gsap.utils.selector(el);
    // As in SetupScene: targets are measured from the live layout, so the scene scales with the card.
    const at = (sel: string) => {
      const box = el.getBoundingClientRect();
      const t = (q(sel)[0] as HTMLElement).getBoundingClientRect();
      return { x: t.left - box.left + t.width * 0.55, y: t.top - box.top + t.height * 0.55 };
    };
    const point = (sel: string) => ({ x: () => at(sel).x, y: () => at(sel).y });
    const fly = (sel: string) => ({ x: () => at(sel).x - at('[data-file]').x, y: () => at(sel).y - at('[data-file]').y });
    const pulse = (sel: string) => gsap.fromTo(q(sel), { boxShadow: '0 0 0 0 rgba(255,255,255,0.45)' }, { boxShadow: '0 0 0 9px rgba(255,255,255,0)', duration: 0.6, ease: 'power2.out' });

    const ctx = gsap.context(() => {
      const names = q('[data-name]');
      const logos = q('[data-ava]');
      if (reduce) {
        // The finished frame, without the motion; the header shows the first agent.
        setStep(list.length - 1);
        gsap.set(q('[data-file], [data-cursor], [data-attach]'), { autoAlpha: 0 });
        gsap.set([...names.slice(1), ...logos.slice(1)], { autoAlpha: 0 });
        gsap.set(q('[data-hello], [data-sent], [data-reply] > *'), { display: 'flex', autoAlpha: 1 });
        gsap.set(q('[data-work-run]'), { autoAlpha: 0 });
        gsap.set(q('[data-work-done]'), { autoAlpha: 1 });
        return;
      }
      // The header, on its own loop: the name is a masked ticker - the old one slides up and out while the
      // new one slides up into place, with a touch of blur in motion - and the logo cross-fades in its
      // circle, turning and settling with a small overshoot just behind the name. No empty beat between.
      gsap.set(names, { yPercent: 115, autoAlpha: 0 });
      gsap.set(names[0], { yPercent: 0, autoAlpha: 1 });
      gsap.set(logos, { autoAlpha: 0, scale: 0.55, rotate: -14 });
      gsap.set(logos[0], { autoAlpha: 1, scale: 1, rotate: 0 });
      // immediateRender: false on the incoming halves, or the last one (back to the first agent) would hide
      // the first agent the moment the timeline is built.
      const roll = gsap.timeline({ repeat: -1 });
      names.forEach((_, i) => {
        const j = (i + 1) % names.length;
        roll.addLabel(`s${i}`, '+=1.7')
          .to(names[i], { yPercent: -115, autoAlpha: 0, filter: 'blur(2px)', duration: 0.6, ease: 'expo.inOut' }, `s${i}`)
          .fromTo(names[j], { yPercent: 115, autoAlpha: 0, filter: 'blur(2px)' }, { yPercent: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.6, ease: 'expo.inOut', immediateRender: false }, `s${i}`)
          .to(logos[i], { autoAlpha: 0, scale: 0.55, rotate: 14, duration: 0.4, ease: 'power3.in' }, `s${i}`)
          .fromTo(logos[j], { autoAlpha: 0, scale: 0.55, rotate: -14 }, { autoAlpha: 1, scale: 1, rotate: 0, duration: 0.65, ease: 'back.out(1.6)', immediateRender: false }, `s${i}+=0.18`);
      });
      // The typing dots bob for as long as they are shown.
      gsap.to(q('[data-dot]'), { y: -2.5, duration: 0.32, repeat: -1, yoyo: true, stagger: 0.12, ease: 'sine.inOut' });

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2, defaults: { ease: 'power3.inOut' } });
      tl.call(() => setStep(0))
        .set(q('[data-anim]'), { clearProps: 'all' })
        .set(q('[data-typed]'), { text: '' })
        .set(q('[data-cursor]'), { x: el.clientWidth * 0.5, y: el.clientHeight * 0.5, autoAlpha: 0 })
        .fromTo(q('[data-file]'), { autoAlpha: 0, x: 0, y: 16, scale: 0.9 }, { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)' })
        .to({}, { duration: 0.4 })
        // The agent's chat is open, and it says hello.
        .call(() => setStep(1))
        .set(q('[data-hello]'), { display: 'flex' })
        .fromTo(q('[data-hello]'), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'expo.out' })
        .to(q('[data-cursor]'), { autoAlpha: 1, duration: 0.2 }, '+=0.3')
        .to(q('[data-cursor]'), { ...point('[data-file]'), duration: 0.8 })
        // Dragged onto the composer, it becomes an attachment there.
        .call(() => setStep(2), [], '+=0.1')
        .to(q('[data-file]'), { ...fly('[data-compose]'), scale: 0.9, duration: 0.85 })
        .to(q('[data-cursor]'), { ...point('[data-compose]'), duration: 0.85 }, '<')
        .to(q('[data-compose]'), { borderColor: 'rgba(255,255,255,0.5)', duration: 0.3 }, '-=0.35')
        .to(q('[data-file]'), { autoAlpha: 0, scale: 0.8, duration: 0.2 })
        .to(q('[data-ph]'), { autoAlpha: 0, duration: 0.1 }, '<')
        .fromTo(q('[data-attach]'), { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(1.8)' }, '<')
        .to(q('[data-compose]'), { borderColor: 'rgba(255,255,255,0.14)', duration: 0.3 }, '<0.1')
        // "install this skill", then send.
        .call(() => setStep(3), [], '+=0.2')
        .to(q('[data-typed]'), { text: 'install this skill', duration: 0.75, ease: 'none' })
        .to(q('[data-cursor]'), { ...point('[data-send]'), duration: 0.55 }, '+=0.1')
        .add(() => { pulse('[data-send]'); })
        .to(q('[data-send]'), { scale: 0.9, duration: 0.08, yoyo: true, repeat: 1, ease: 'power1.inOut' }, '<')
        .set(q('[data-typed]'), { text: '' }, '+=0.05')
        .to(q('[data-attach]'), { autoAlpha: 0, duration: 0.15 }, '<')
        .to(q('[data-ph]'), { autoAlpha: 1, duration: 0.2 }, '<0.1')
        .set(q('[data-sent]'), { display: 'flex' }, '<')
        .fromTo(q('[data-sent]'), { autoAlpha: 0, y: 10, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: 'expo.out' }, '<')
        .to(q('[data-cursor]'), { autoAlpha: 0, duration: 0.25 }, '<')
        // The agent types, unpacks it, and says it is ready.
        .call(() => setStep(4), [], '+=0.3')
        .set(q('[data-typing]'), { display: 'flex' })
        .fromTo(q('[data-typing]'), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'expo.out' })
        .to(q('[data-typing]'), { autoAlpha: 0, duration: 0.2 }, '+=0.9')
        .set(q('[data-typing]'), { display: 'none' })
        .set(q('[data-reply] > :nth-child(1)'), { display: 'flex' })
        .fromTo(q('[data-reply] > :nth-child(1)'), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'expo.out' })
        .set(q('[data-reply] > :nth-child(2)'), { display: 'flex' }, '+=0.25')
        .fromTo(q('[data-reply] > :nth-child(2)'), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'expo.out' })
        .to(q('[data-work-run]'), { autoAlpha: 0, duration: 0.15 }, '+=0.9')
        .fromTo(q('[data-work-done]'), { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, '<')
        .set(q('[data-reply] > :nth-child(3)'), { display: 'flex' }, '+=0.35')
        .fromTo(q('[data-reply] > :nth-child(3)'), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'expo.out' })
        .to({}, { duration: 2.4 });
    }, el);
    return () => ctx.revert();
  }, [run, list.length]);

  return (
    <div>
      <div className="flex justify-end">
        <button type="button" onClick={replay} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] text-fg-2 hover:text-fg"><span ref={spin} className="inline-flex"><ArrowCounterClockwiseIcon size={14} /></span>Replay</button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-center">
        <div ref={scene} className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-ink" aria-hidden="true">
          <Cursor />
          <Stage>
            <div className="absolute inset-0 flex flex-col bg-ink-1 text-fg">
              {/* Header: whose chat this is, and the name keeps changing - it is any agent. */}
              <div className="flex h-[44px] shrink-0 items-center gap-2.5 border-b border-line px-4">
                <span className="relative size-[24px] shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-white/20 ring-offset-1 ring-offset-ink-1">
                  {AGENTS.map(([n, icon, k]) => (
                    <span key={n} data-ava className="absolute inset-0 grid place-items-center">
                      <img src={icon} alt="" draggable={false} className="size-[16px] max-w-none" style={{ transform: `scale(${k})` }} />
                    </span>
                  ))}
                </span>
                <span className="relative h-[18px] min-w-0 flex-1 overflow-hidden">
                  {AGENTS.map(([n]) => (
                    <span key={n} data-name className="absolute inset-x-0 top-0 truncate text-[12.5px] font-medium leading-[18px] tracking-[-0.01em]">{n}</span>
                  ))}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-fg-3"><span className="size-[5px] rounded-full bg-fg-2" />Agent</span>
              </div>

              {/* The conversation, newest at the bottom. Messages take no room until they appear; older ones fade
                  out under the header instead of being cut off. */}
              <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden px-4 pb-2.5 pt-3 text-[11px] leading-snug [mask-image:linear-gradient(to_bottom,transparent,black_22px)]">
                <Them data-anim data-msg data-hello className="hidden">Hi. What can I help you with?</Them>
                <div data-anim data-msg data-sent className="hidden flex-col items-end gap-1">
                  <span className="flex items-center gap-1.5 rounded-lg border border-line-2 bg-ink-3 px-2 py-1.5 text-[10.5px] text-fg"><FileZipIcon size={13} className="text-fg-2" />{file}</span>
                  <span className="rounded-lg bg-white px-3 py-1.5 font-medium text-black">install this skill</span>
                </div>
                <div data-anim data-msg data-typing className="hidden w-fit items-center gap-1 rounded-lg border border-line bg-ink-3 px-3 py-2.5">
                  <span data-dot className="size-1 rounded-full bg-fg-2" /><span data-dot className="size-1 rounded-full bg-fg-2" /><span data-dot className="size-1 rounded-full bg-fg-2" />
                </div>
                <div data-reply className="flex flex-col gap-1.5">
                  <Them data-anim data-msg className="hidden">On it. Installing {real ? title : 'your skill'}.</Them>
                  <div data-anim data-msg className="hidden ml-[28px] w-fit items-center gap-2 rounded-md border border-line bg-ink-2 px-2.5 py-1.5 text-[10px] text-fg-2">
                    <span className="relative grid size-3 place-items-center">
                      <CircleNotchIcon data-anim data-work-run size={12} className="absolute animate-spin text-fg" />
                      <CheckIcon data-anim data-work-done size={12} weight="bold" className="invisible absolute text-fg" />
                    </span>
                    Added {skill} to my skills
                  </div>
                  <Them data-anim data-msg className="hidden">Done. I'll use it whenever a task fits.</Them>
                </div>
              </div>

              {/* The composer: attach, type, send. */}
              <div className="shrink-0 px-4 pb-3.5">
                <div data-anim data-compose className="flex min-h-[38px] items-center gap-2 rounded-xl border border-line-2 bg-ink-2 py-1 pl-3 pr-1">
                  <PaperclipIcon size={13} className="shrink-0 text-fg-3" />
                  <span data-anim data-attach className="invisible flex shrink-0 items-center gap-1 rounded-md border border-line bg-ink-3 px-1.5 py-0.5 text-[9.5px] text-fg"><FileZipIcon size={11} className="text-fg-2" /><span className="max-w-[110px] truncate">{file}</span></span>
                  <span className="relative h-[16px] min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[11px] leading-[16px]">
                    <span data-anim data-ph className="absolute inset-y-0 left-0 text-fg-3">Message your agent</span>
                    <span data-typed />
                  </span>
                  <span data-anim data-send className="grid size-[28px] shrink-0 place-items-center rounded-lg bg-white text-black"><ArrowUpIcon size={13} weight="bold" /></span>
                </div>
              </div>
            </div>
          </Stage>
          {/* The download, top right under the header: the composer it is dropped on is at the bottom. */}
          <FileChip file={real ? `~/Downloads/${file}` : file} className="absolute right-3 top-[17%] z-10" />
        </div>

        <ol className="space-y-3">
          {list.map((s, n) => (
            <li key={s.t} className={cn('flex gap-3 transition-opacity duration-500', n === step ? 'opacity-100' : n < step ? 'opacity-60' : 'opacity-40')}>
              <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] transition-colors duration-500', n === step ? 'border-white bg-white text-black' : 'border-line-2 text-fg-2')}>{n < step ? <CheckIcon size={11} weight="bold" /> : n + 1}</span>
              <span className="min-w-0">
                <span className="block text-[14.5px] leading-snug text-fg">{s.t}</span>
                <span className="mt-0.5 block break-words text-[12.5px] leading-snug text-fg-2">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});

// One of the agent's messages: a quiet monochrome mark beside a bordered card (no bubble tail).
function Them({ children, className, ...rest }: ComponentProps<'div'>) {
  return (
    <div {...rest} className={cn('items-start gap-2', className)}>
      <span className="grid size-[20px] shrink-0 place-items-center rounded-full border border-line-2 bg-ink-3 text-fg"><AgentsLogo size={11} mono /></span>
      <span className="max-w-[78%] rounded-lg border border-line bg-ink-3 px-3 py-1.5 text-fg">{children}</span>
    </div>
  );
}
