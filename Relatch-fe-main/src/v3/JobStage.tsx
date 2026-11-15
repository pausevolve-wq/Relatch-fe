// One card for the whole job. It starts as the thinking panel (live mark, shimmer, real steps); when
// the skill is ready it widens and grows into the skill preview. Nothing jumps to a new screen.
//
// The setup walkthrough is not part of this card: the card is just the skill. The walkthrough is a
// pop-up (InstallDialog) opened from the sidebar, and by Download, since downloading is step one of it.
//
// A skill can be built from up to three documents, one skill file each (useSkillJob). The card then
// says how many, a switcher next to the name shows each file, and an "Add a document" button beside the
// name (while the skill can still take one) adds the one the person went to fetch. A document added
// after the skill is ready is written INSIDE the preview: it is selected, its thinking plays where the
// skill text was, and its finished skill file blurs in there. Downloading completes the skill: after
// that it takes no more documents (useSkillJob.complete).
//
// The preview is a panel the height of the screen with the skill scrolling INSIDE it, under a header
// that never moves. Nothing can scroll past the header by construction, at any speed: an earlier
// version pinned the header over the page's own scroll and cut the card above it from a scroll
// handler, and a fast scroll outran the handler for a frame (the "Thought for" box flashed above the
// header).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { CopyIcon, CheckIcon, DownloadSimpleIcon, ArrowRightIcon, CaretDownIcon, WarningCircleIcon, PlusIcon, FileTextIcon, CircleNotchIcon } from '@phosphor-icons/react';
import { Thinking } from './Thinking';
import { SkillMarkdown } from './SkillMarkdown';
import { TARGET_NAME, TargetLogo } from './logos';
import type { Target } from './skillExport';
import { ACCEPT } from './Start';
import { useDismiss } from './useDismiss';
import { countSections, type Step } from './useSkillJob';
import { downloadPlan, downloadSkill, claudeFile, downloadedHeader, type SkillPart } from './skillExport';
import type { Unlock } from './auth/AuthSheet';
import { estimateTokens } from '@/engine/core';
import { cn } from '@/lib/utils';

const pill = 'inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14.5px] font-medium transition-[background-color,color,transform,opacity] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:pointer-events-none';
const ring = 'focus-visible:outline-2 focus-visible:outline-white/60';
const chip = cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line-2 px-3 text-[13px] text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg', ring);
// The same chip one step down, for the preview header, where it sits beside the skill's name: at full size
// it read as heavy as the name itself.
const chipSm = cn('inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-line-2 px-2.5 text-[12.5px] text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg', ring);

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

// One skill file on the card: finished, still being written, or failed. `fileName` (the document it
// came from) exists only while the job is live; a skill reopened from the history never had it stored.
export interface Part { key: string; name: string; content: string; degraded: boolean; status: 'thinking' | 'done' | 'error'; note?: string | null; fileName?: string; steps?: Step[]; seconds?: number }

// Whether more documents can join the skill on screen, how many, why not when they can't, and how to
// complete it (on download).
export interface Adding { canAdd: boolean; left: number; closed: string | null; onAdd: (files: File[]) => void; complete: () => void }

export type Plan = ReturnType<typeof downloadPlan>;

// The file's header as it downloads, between its --- markers, styled like the skill's code blocks: keys
// muted, values in full. The caption says why it matters.
function FileHeader({ yaml, agent }: { yaml: string; agent: string }) {
  const lines = yaml.split('\n');
  return (
    <figure className="mb-8">
      <figcaption className="mb-2 text-[13px] leading-snug text-fg-2">{agent} reads this header first: the description is how it decides when to use the skill.</figcaption>
      <div className="overflow-x-auto rounded-xl border border-line bg-ink-2 px-4 py-3 font-mono text-[13px] leading-relaxed scroll-thin">
        <p className="text-fg-3">---</p>
        {lines.map((l, i) => {
          const kv = /^(\s*)([\w-]+):\s?(.*)$/.exec(l);
          if (!kv) return <p key={i} className="whitespace-pre-wrap text-fg-2">{l}</p>;
          const value = kv[3].replace(/^"([\s\S]*)"$/, '$1').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          return (
            <p key={i} className={cn('break-words', kv[1] && 'pl-5')}>
              <span className="text-fg-3">{kv[2]}:</span>{value && <> <span className={kv[2] === 'description' || kv[2] === 'name' ? 'text-fg' : 'text-fg-2'}>{value}</span></>}
            </p>
          );
        })}
        <p className="text-fg-3">---</p>
      </div>
    </figure>
  );
}

function Preview({ parts, target, signedIn, adding, pick, onInstall, onAnother, onSignUp, resume, onResumed }: { parts: Part[]; target: Target; signedIn: boolean; adding: Adding; pick: () => void; onInstall: (name: string, plan: Plan) => void; onAnother: () => void; onSignUp: (unlock?: Unlock) => void; resume?: Unlock['action'] | null; onResumed?: () => void }) {
  const done = useMemo(() => parts.filter((p) => p.status === 'done'), [parts]);
  const pending = parts.filter((p) => p.status === 'thinking').length;
  const [name, setName] = useState(() => done[0]?.name || 'Untitled skill');
  const [sel, setSel] = useState(() => done[0]?.key ?? parts[0]?.key ?? '');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useDismiss(menuBox, menu, () => setMenu(false));

  // The menu opens from the switcher's left edge; on a narrow phone that can run past the screen, so it
  // is pulled back in to keep 16px clear.
  useLayoutEffect(() => {
    const m = menuBox.current?.querySelector<HTMLElement>('[role="menu"]');
    if (!m) return;
    const over = m.getBoundingClientRect().right - (window.innerWidth - 16);
    if (over > 0) m.style.left = `${-over}px`;
  }, [menu]);

  // A document added while the skill is on screen takes the card over: it is selected, so its thinking
  // plays where the skill text was.
  const known = useRef(new Set(parts.map((p) => p.key)));
  useEffect(() => {
    const fresh = parts.find((p) => !known.current.has(p.key));
    parts.forEach((p) => known.current.add(p.key));
    if (!fresh) return;
    setSel(fresh.key);
    setExpanded(false);
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [parts]);

  const part = parts.find((p) => p.key === sel) ?? done[0];
  const multi = parts.length > 1;
  // Copy is offered only when the download is one Claude .md file, so the clipboard holds that whole file.
  // A set downloads as a ZIP and a Codex skill as a folder: no single file is the skill, so a copy would
  // install part of one. A document that failed isn't in the download; one still being written will be.
  const single = target === 'claude' && parts.filter((p) => p.status !== 'error').length === 1;
  const skill: SkillPart[] = useMemo(() => done.map((p) => ({ name: p.name, content: p.content })), [done]);
  const plan = downloadPlan(target, name, skill);
  // An Agents skill is read by whichever agent loads it.
  const agent = target === 'agents' ? 'The agent' : TARGET_NAME[target];
  // One file reads under the name in the header, which is that file's own name; a set's files keep theirs.
  const shownMd = done.length > 1 ? part.content : claudeFile(part.content, name);
  // The header this file downloads with (name, description, metadata), shown above the skill: it is what
  // Claude or Codex reads first, to decide when to use it.
  const header = part.status === 'done' ? downloadedHeader(target, name, skill, done.indexOf(part)) : '';

  // When the selected document finishes writing, its skill file resolves out of a blur in place.
  const lastStatus = useRef(new Map(parts.map((p) => [p.key, p.status])));
  useLayoutEffect(() => {
    const before = lastStatus.current.get(part.key);
    parts.forEach((p) => lastStatus.current.set(p.key, p.status));
    if (before !== 'thinking' || part.status !== 'done' || !body.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    body.current.animate([
      { opacity: 0, transform: 'translateY(10px)', filter: 'blur(10px)' },
      { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' },
    ], { duration: 650, easing: OUT });
  }, [part.key, part.status, parts]);

  // fitFold: folded, the skill shows at least 460px. On a tall screen (a tablet held upright, a Fold's
  // inner screen) it shows as much more as fits with the rest of the card, its footer included, still on
  // screen, so the card ends at its height limit the way it does in landscape. Measured rather than a
  // fixed number because the rest of the card changes with the state: the "Thought for" row, the
  // signed-out footer (whose "Create free account" must stay in view), a header that wraps.
  // Written on the element before paint, not through state, so the thinking-to-preview morph (JobStage's
  // layout effect, which runs after this one) already grows the card to its final height.
  const fold = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const f = fold.current;
    const sc = scroller.current;
    const card = sc?.parentElement;
    if (!f || !sc || !card) return;
    if (expanded) { f.style.maxHeight = ''; return; }
    const fit = () => {
      const limit = parseFloat(getComputedStyle(card).maxHeight);
      // The card's header and borders, plus everything in the scroller except the folded skill.
      const rest = card.offsetHeight - sc.clientHeight + sc.scrollHeight - f.offsetHeight;
      f.style.maxHeight = `${Number.isFinite(limit) ? Math.max(460, Math.floor(limit - rest)) : 460}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [expanded, part.key, part.status, signedIn, adding.canAdd, note, done.length]);

  // "Downloaded" stops being true when the download would differ: another file joined, or a rename.
  const sig = `${done.map((p) => p.key).join(',')}|${name}`;
  const lastSig = useRef(sig);
  useEffect(() => {
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    setSaved(false);
    setNote(null);
  }, [sig]);

  // Signed out (the free skill, 2026-11-15 hybrid plan): it is a preview. Copy, Download and reading the whole
  // skill open the unlock sheet; once they're in, V3App hands the action back here (`resume`) and it carries on.
  const ask = (action: Unlock['action']): Unlock => ({ name, sections: done.reduce((n, p) => n + countSections(p.content), 0), agent: target === 'agents' ? 'Agent' : TARGET_NAME[target], action });

  const download = async () => {
    if (!signedIn) return onSignUp(ask('download'));
    const r = await downloadSkill(target, name, skill);
    setNote(r.note);
    if (!r.saved) return;
    setSaved(true);
    // Downloading completes the skill: no more documents join it after this.
    adding.complete();
    // Downloading is step 1 of setup, so carry the user straight into the rest of it.
    window.setTimeout(() => onInstall(name, plan), 350);
  };

  const copy = async () => {
    if (!signedIn) return onSignUp(ask('copy'));
    try { await navigator.clipboard.writeText(claudeFile(skill[0].content, name)); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };

  // Back from the unlock sheet, signed in: do what they tapped. (A copy may be refused by the browser this long
  // after the tap; then the button is right there.)
  useEffect(() => {
    if (!signedIn || !resume) return;
    onResumed?.();
    if (resume === 'download') void download();
    else if (resume === 'copy') void copy();
    else setExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per hand-back
  }, [signedIn, resume]);

  // The skill scrolls inside the card. A wheel anywhere else on the page (the margins beside the card,
  // its header) scrolls it too, so the page still behaves like one long document.
  useEffect(() => {
    const sc = scroller.current;
    const pane = sc?.closest('main');
    if (!sc || !pane) return;
    const wheel = (e: WheelEvent) => {
      const t = e.target as Node;
      if (e.ctrlKey || sc.contains(t) || !pane.contains(t) || menuBox.current?.contains(t)) return;
      sc.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY });
    };
    window.addEventListener('wheel', wheel, { passive: true });
    return () => window.removeEventListener('wheel', wheel);
  }, []);

  // Several files: a switcher to read each one.
  const switcher = multi && (
    <div ref={menuBox} className="relative shrink-0">
      <button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} className={cn(chipSm, menu && 'bg-white/[0.06] text-fg')}>
        {parts.indexOf(part) + 1} of {parts.length}{pending > 0 && <CircleNotchIcon size={12} className="animate-spin" />}<CaretDownIcon size={12} className={cn('transition-transform duration-200', menu && 'rotate-180')} />
      </button>
      {menu && (
        <div role="menu" aria-label="Skill files" className="absolute left-0 top-full z-30 mt-2 w-[min(300px,calc(100vw-48px))] origin-top-left rounded-2xl border border-line-2 bg-ink-2/95 p-1.5 shadow-[0_24px_60px_rgb(0_0_0/0.6)] backdrop-blur-xl transition-[opacity,transform] duration-200 ease-out-expo starting:scale-[0.97] starting:opacity-0">
          {parts.map((p) => (
            <button key={p.key} role="menuitemradio" aria-checked={p.key === part.key} onClick={() => { setSel(p.key); setMenu(false); scroller.current?.scrollTo({ top: 0 }); }} className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]', p.key === part.key && 'bg-white/[0.06]', ring)}>
              <FileTextIcon size={15} className="shrink-0 text-fg-2" />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13.5px]', p.status === 'done' ? 'text-fg' : 'text-fg-2')}>{p.name}</span>
                {p.status !== 'done' && <span className={cn('block truncate text-[12px]', p.status === 'error' ? 'text-amber-200/90' : 'text-fg-3')}>{p.status === 'thinking' ? 'Writing…' : p.note || "Couldn't be written"}</span>}
              </span>
              {p.status === 'thinking' ? <CircleNotchIcon size={14} className="shrink-0 animate-spin text-fg-3" /> : p.key === part.key ? <CheckIcon size={14} weight="bold" className="shrink-0 text-fg" /> : null}
            </button>
          ))}
          {adding.closed && (<>
            <div aria-hidden="true" className="mx-1 my-1.5 h-px bg-line" />
            <p className="px-2.5 py-2 text-[12.5px] leading-snug text-fg-3">{adding.closed}</p>
          </>)}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* A straight rule under it that never changes: the skill always ends at that line, at any scroll
          speed. (It used to give way to the fade on scroll, and a fast scroll showed text running
          straight into the header before the fade arrived.) */}
      {/* Under 360px (a Galaxy Fold's cover screen) the card's sides come in to 16px, so Copy and
          "Download skill" still fit on one line. */}
      <header className="relative z-20 shrink-0 rounded-t-[28px] border-b border-line px-5 py-4 max-[360px]:px-4 sm:px-8">
        <div data-in className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-[min(100%,240px)] flex-1">
            <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] font-medium text-fg-3">
              <TargetLogo target={target} size={13} />{target === 'agents' ? 'Agent' : agent} skill
              {multi && <><span aria-hidden="true">·</span>{parts.length} files</>}
              <span aria-hidden="true">·</span><span className="text-fg-2">{pending ? `Writing ${pending} more` : saved || adding.closed?.startsWith('Downloaded') ? 'Complete' : 'Ready'}</span>
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
              <label className="min-w-0">
                <span className="sr-only">Skill name</span>
                {/* Sized to its text, so the switcher and the add button sit right after the name. */}
                <input value={name} onChange={(e) => setName(e.target.value)} className="field-sizing-content min-w-[4ch] max-w-full rounded-md bg-transparent text-[clamp(20px,2.4vw,26px)] font-semibold tracking-[-0.03em] text-fg outline-none hover:bg-white/[0.03] focus:bg-white/[0.04]" />
              </label>
              {switcher}
              {adding.canAdd && (
                <button onClick={pick} className={chipSm} title={`Up to ${adding.left} more, built into this same skill`}>
                  <PlusIcon size={12} weight="bold" />Add a document
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {single && (
              <button onClick={copy} aria-label="Copy skill text" className={cn(pill, 'border border-line-2 px-3.5 text-fg hover:bg-white/[0.06]')}>
                {copied ? <CheckIcon size={16} weight="bold" /> : <CopyIcon size={16} />}<span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
            {/* Waits for every document to finish, so a download is never missing the one being written. */}
            <button onClick={download} disabled={pending > 0} className={cn(pill, 'whitespace-nowrap bg-white text-black hover:bg-white/90 disabled:opacity-60')}>
              {pending > 0 ? <CircleNotchIcon size={17} className="animate-spin" /> : saved ? <CheckIcon size={17} weight="bold" /> : <DownloadSimpleIcon size={17} weight="bold" />}
              {pending > 0 ? 'Writing…' : saved ? 'Downloaded' : plan.label}
            </button>
          </div>
        </div>
        {note && <p role="status" className="mt-3 flex items-start gap-2 text-[13px] text-amber-100"><WarningCircleIcon size={16} className="mt-px shrink-0" />{note}</p>}
      </header>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-[27px] scroll-thin scroll-round-b">
        {/* The fade: the skill darkens into the header's rule as it passes under it. Its opacity follows
            the scroll on the compositor (.skill-fade in v3.css). No blur: blurred text under the rule
            read as a glowing smudge. */}
        <div aria-hidden="true" className="skill-fade pointer-events-none sticky top-0 z-10 -mb-6 h-6 bg-gradient-to-b from-ink-1 to-transparent" />

        <div ref={body}>
          {part.status === 'thinking' ? (
            // The added document being written, in the card: the same thinking as the first one, smaller.
            <div data-in className="px-5 py-6 max-[360px]:px-4 sm:px-8">
              <Thinking key={part.key} steps={part.steps ?? []} running className="rounded-2xl border border-line bg-white/[0.02] p-5 sm:p-6" />
            </div>
          ) : part.status === 'error' ? (
            <div data-in className="px-5 py-6 max-[360px]:px-4 sm:px-8">
              <p className="flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-[14px] text-amber-100">
                <WarningCircleIcon size={18} className="mt-px shrink-0" />{part.fileName ? `${part.fileName}: ` : ''}{part.note || "This document couldn't be written into a skill."}
              </p>
            </div>
          ) : (<>
            <div data-in className="space-y-3 px-5 pt-5 max-[360px]:px-4 sm:px-8">
              {/* A skill reopened from the history has no source file name and no reasoning steps: neither is kept. */}
              <p className="text-[14px] text-fg-2">{countSections(part.content)} sections · about {estimateTokens(part.content).toLocaleString()} tokens{part.fileName && ` · from ${part.fileName}`}</p>
              {part.steps && part.steps.length > 0 && <Thinking key={part.key} steps={part.steps} running={false} seconds={part.seconds} />}
              {part.degraded && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-[14px] text-amber-100">
                  <WarningCircleIcon size={18} className="mt-px shrink-0" />The AI service was busy, so the backup writer built this. Review it before you rely on it, or try again.
                </p>
              )}
            </div>

            {/* Folded: 460px here, and taller on a tall screen (fitFold above). */}
            <div ref={fold} data-in className={cn('relative px-5 py-7 max-[360px]:px-4 sm:px-10', !expanded && 'max-h-[460px] overflow-hidden')}>
              {header && <FileHeader yaml={header} agent={agent} />}
              <SkillMarkdown md={shownMd} />
              {!expanded && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-ink-1 to-transparent" />}
            </div>
            <div data-in className="flex justify-center pb-4">
              <button onClick={() => (signedIn || expanded ? setExpanded((x) => !x) : onSignUp(ask('read')))} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] text-fg-2 hover:text-fg">
                {expanded ? 'Show less' : 'Read the whole skill'}<CaretDownIcon size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
              </button>
            </div>
          </>)}
        </div>

        <div data-in className="flex flex-col items-center gap-3 border-t border-line bg-white/[0.015] px-5 py-8 text-center max-[360px]:px-4 sm:px-10">
          {signedIn ? (
            <button onClick={onAnother} className={cn(pill, 'bg-white text-black hover:bg-white/90')}>Make another skill<ArrowRightIcon size={16} weight="bold" /></button>
          ) : (
            <>
              <p className="text-[20px] font-semibold tracking-[-0.03em] text-fg">Your free skill is ready.</p>
              <p className="max-w-[44ch] text-[15px] text-fg-2">Create a free account to download it, copy it and read every section. Then make up to 3 skills a day.</p>
              <div className="mt-1 flex flex-wrap justify-center gap-2.5">
                <button onClick={() => onSignUp(ask('download'))} className={cn(pill, 'bg-white text-black hover:bg-white/90')}>Unlock my skill<ArrowRightIcon size={16} weight="bold" /></button>
                <button onClick={onAnother} className={cn(pill, 'text-fg-2 hover:text-fg')}>Start over</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// `saved` is a skill reopened from the history: there is no thinking to watch, so it opens as the preview.
export function JobStage({ phase, parts, target, signedIn, saved = false, adding, onInstall, onAnother, onSignUp, resume, onResumed }: { phase: 'thinking' | 'done'; parts: Part[]; target: Target; signedIn: boolean; saved?: boolean; adding: Adding; onInstall: (name: string, plan: Plan) => void; onAnother: () => void; onSignUp: (unlock?: Unlock) => void; resume?: Unlock['action'] | null; onResumed?: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Mounted onto a skill that is already finished (a saved one, or the live one after coming back from
  // the home screen or another skill): show it straight away. The thinking-to-preview morph is only for
  // a job that finishes while this card is on screen.
  const settled = useRef(saved || phase === 'done');
  const [view, setView] = useState<'thinking' | 'preview'>(settled.current ? 'preview' : 'thinking');
  const before = useRef<{ w: number; h: number } | null>(null);
  // A file is being dragged over the card. Counted, because dragenter/leave fire for every child.
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const pick = () => input.current?.click();

  useLayoutEffect(() => {
    if (!settled.current || !card.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    card.current.animate([
      { opacity: 0, transform: 'translateY(14px)', filter: 'blur(10px)' },
      { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' },
    ], { duration: 520, easing: OUT });
  }, []);

  // When the job finishes, give the last findings a moment to land, then morph.
  useEffect(() => {
    if (phase !== 'done' || view !== 'thinking') return;
    const t = window.setTimeout(() => {
      if (card.current) before.current = { w: card.current.offsetWidth, h: card.current.offsetHeight };
      setView('preview');
    }, 1100);
    return () => window.clearTimeout(t);
  }, [phase, view]);

  useLayoutEffect(() => {
    const el = card.current;
    const from = before.current;
    if (view !== 'preview' || !el || !from) return;
    before.current = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = { w: el.offsetWidth, h: el.offsetHeight };
    // The card itself settles in out of a blur while it grows.
    el.animate([
      { opacity: 0, transform: 'translateY(36px) scale(0.985)', filter: 'blur(14px)' },
      { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
    ], { duration: 900, easing: OUT });
    gsap.timeline()
      .fromTo(el, { width: from.w, height: from.h, overflow: 'hidden' }, { width: to.w, height: to.h, duration: 0.95, ease: 'expo.inOut', clearProps: 'width,height,overflow' })
      .from(el.querySelectorAll('[data-in]'), { opacity: 0, y: 18, filter: 'blur(8px)', duration: 0.75, ease: 'expo.out', stagger: 0.07 }, 0.4);
  }, [view]);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const focus = parts.find((p) => p.status === 'thinking') ?? parts[0];
  const addButton = adding.canAdd && (
    <button onClick={pick} className={chip}><PlusIcon size={13} weight="bold" />Add a document</button>
  );

  return (
    // The whole pane takes a dropped file: added to this skill when it can still take one, and never
    // left to the browser (which would navigate away to the file).
    <section
      className="px-4 pb-4 pt-10 max-[360px]:px-3 sm:px-6 sm:pb-6 sm:pt-16"
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = adding.canAdd ? 'copy' : 'none'; }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setOver(false); const files = Array.from(e.dataTransfer.files); if (adding.canAdd && files.length) adding.onAdd(files); }}
    >
      {/* The finished skill takes 78% of the pane, between 980px and 1160px. With the sidebar open on a
          laptop that is the same 980px as before; with it closed the card grows into the room instead of
          floating in empty space, and since the width follows the pane it grows in step with the
          sidebar's slide. 1160px keeps the skill's lines readable on a wide monitor.
          As a preview it is a panel that stops at the bottom of the screen: the page above it is the
          workspace row (phones and tablets) and the section's top padding. */}
      <div ref={card} className={cn('relative mx-auto w-full rounded-[28px] border border-line bg-ink-1', view === 'thinking' ? 'max-w-[620px]' : 'flex max-h-[max(320px,calc(100dvh-112px-env(safe-area-inset-top,0px)))] max-w-[clamp(980px,78%,1160px)] flex-col sm:max-h-[max(320px,calc(100dvh-144px-env(safe-area-inset-top,0px)))] lg:max-h-[max(320px,calc(100dvh-88px))]')}>
        {view === 'thinking' || !parts.some((p) => p.status === 'done')
          ? <Thinking steps={focus?.steps ?? []} running className="rounded-none border-0 bg-transparent" files={parts.length > 1 ? parts.map((p) => ({ name: p.fileName ?? p.name, status: p.status })) : undefined} footer={addButton} />
          : <Preview parts={parts} target={target} signedIn={signedIn} adding={adding} pick={pick} onInstall={onInstall} onAnother={onAnother} onSignUp={onSignUp} resume={resume} onResumed={onResumed} />}

        {over && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-[28px] border-2 border-dashed border-white/35 bg-ink/75 p-6 text-center backdrop-blur-sm">
            <div>
              <p className="text-[17px] font-medium text-fg">{adding.canAdd ? 'Drop to add it to this skill' : "This skill can't take more documents"}</p>
              <p className="mt-1 text-[13.5px] text-fg-2">{adding.canAdd ? `${adding.left} more ${adding.left === 1 ? 'document' : 'documents'} can join it.` : adding.closed}</p>
            </div>
          </div>
        )}
      </div>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) adding.onAdd(files); e.target.value = ''; }} />
    </section>
  );
}
