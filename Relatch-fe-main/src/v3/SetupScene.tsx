// "Set it up": a short animated walkthrough that plays inside the skill card, so installing feels like
// the last step of the same flow rather than a separate help video. The scenes are schematic (not
// screenshots) and follow V2's install instructions:
//   Claude app : download -> Customize -> Skills -> + -> upload
//   Claude Code: save as ~/.claude/skills/<slug>/SKILL.md, then run claude
//   Codex      : save as .agents/skills/<slug>/SKILL.md at the repo root, then run codex
// A ZIP download (every Codex skill, and a Claude skill built from several documents: skillExport.ts)
// is unzipped into the skills folder instead, and the steps and command say so.
// Since V3: Claude Code opens on its own welcome screen and the skill shows in its / menu (Claude Code
// lists a skill by its folder name). The Codex app gets its own scene: unzip into ~/.agents/skills,
// Codex's folder for your own skills in every project, then type $ in the composer and pick it.
// v23: the Claude app follows its real path (sidebar -> Customize -> Skills -> Add -> Upload skill ->
// drop the file -> Upload -> it joins "Created by you"); in Claude Code the person opens it first, drops
// the file in and asks Claude to install it, then finds it with /; the Codex app's folder window opens
// centred over the dimmed app, since unzipping happens outside Codex.
// v24: the Codex CLI works the same way as Claude Code, in Codex's own words (its welcome box, its
// approval prompt, "• Ran", the $ skill menu: taken from OpenAI's docs and the TUI's test snapshots in
// openai/codex), into ~/.agents/skills. Each step now carries a line of help under it.
// v25: the Codex app is drop-and-ask too, no unzipping by hand: Manas tested it on 2026-10-19 (a
// production ZIP dropped into the Codex app with "install this skill", then found with $).
import { useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { TextPlugin } from 'gsap/TextPlugin';
import {
  CheckIcon, CopyIcon, ArrowCounterClockwiseIcon, FileTextIcon, PlusIcon,
  HouseIcon, ClockIcon, BooksIcon, PuzzlePieceIcon, DotsThreeIcon, FolderSimpleIcon, HandIcon, MicrophoneIcon, ArrowUpIcon, CaretDownIcon,
  SidebarSimpleIcon, ArrowLeftIcon, ArrowRightIcon, MagnifyingGlassIcon, StackIcon, ShapesIcon, ToolboxIcon, LaptopIcon,
  UploadSimpleIcon, PencilSimpleIcon, ChatCircleIcon, VideoCameraIcon, DotsThreeVerticalIcon, CircleNotchIcon, ScrollIcon,
  CubeIcon, TableIcon, ChartPieSliceIcon, ArticleIcon,
} from '@phosphor-icons/react';
import { ClaudeLogo, CodexOutline } from './logos';
import { SlidingThumb } from './SlidingThumb';
import { cn } from '@/lib/utils';
import { captureEvent } from '../analytics';

gsap.registerPlugin(TextPlugin);

type Mode = 'app' | 'code' | 'codexApp' | 'codex';

// Each step is what to do, and a line of help under it (where it is, what to expect, the usual snag).
type Step = { t: string; d: string };
function stepsFor(mode: Mode, zip: boolean, file: string, real: boolean): Step[] {
  const got = { t: zip ? 'Download the ZIP' : 'Download your skill', d: real ? `It saves to your Downloads as ${file}` : 'It saves to your Downloads' };
  const it = zip ? 'the ZIP' : 'the file';
  if (mode === 'app') return [
    got,
    { t: 'Open Claude and go to Customize', d: 'It is in the sidebar, in the Claude app and on claude.ai' },
    { t: 'Choose Skills, then Add, then Upload skill', d: 'Add is the white button at the top right' },
    { t: `Drop ${it} in and press Upload`, d: 'A quick security scan runs, then it is under Created by you' },
    { t: 'Just ask. Claude uses it when it fits', d: 'Skills need Code execution on: Settings, then Capabilities' },
  ];
  if (mode === 'code') return [
    got,
    { t: 'Open Claude Code', d: 'Run claude in your terminal, in any project' },
    { t: `Drop ${it} in and ask Claude to install it`, d: 'It goes to ~/.claude/skills. Allow the command if Claude asks' },
    { t: 'Type / to find it, or just ask', d: 'Claude also uses it on its own whenever a task fits' },
  ];
  if (mode === 'codexApp') return [
    got,
    { t: 'Open the Codex app', d: 'Start a new chat, in any project' },
    { t: 'Drop the ZIP in and ask Codex to install it', d: 'Type "install this skill". If Codex asks to run a command, allow it' },
    { t: 'Type $ and pick your skill', d: 'Or just describe the task: Codex uses it when it fits' },
  ];
  return [
    got,
    { t: 'Run codex', d: 'In your terminal, in any project' },
    { t: `Drop ${it} in and ask Codex to install it`, d: 'Codex asks first: choose Yes. It unzips into ~/.agents/skills' },
    { t: 'Type $ and pick your skill', d: 'Or just describe the task. /skills lists every skill you have' },
  ];
}

// Each agent has an app and a command line; the app comes first, it is what most people use.
const TABS: Record<'claude' | 'codex', [Mode, string][]> = {
  claude: [['app', 'Claude app'], ['code', 'Claude Code']],
  codex: [['codexApp', 'Codex app'], ['codex', 'Codex CLI']],
};

// Stand-in skills already in the Claude app's "Created by you" list, so the new one has company.
const MINE = [
  { name: 'meeting-notes', about: 'Turns raw meeting notes into decisions, owners and dates', when: 'Oct 2' },
  { name: 'brand-voice', about: 'Keeps every draft in the house style and tone', when: 'Sep 18' },
];

// What else the Codex app's $ menu lists: entries that ship with it (from a screenshot of the real menu,
// 2026-10-19), so the new skill sits among real neighbours. None of them come from anyone's own files.
const CODEX_MENU = [
  { name: 'Documents', about: 'Create and edit Word and Google Docs files', from: 'From Documents', Icon: CubeIcon, tone: 'text-[#cbcabc]' },
  { name: 'Analytics Dashboard', about: 'Create spreadsheets with the Analytics Dashboard template', from: 'From OpenAI Templates', Icon: TableIcon, tone: 'text-[#2b9c3e]' },
  { name: 'Business Review', about: 'Create presentations with the Business Review template', from: 'From OpenAI Templates', Icon: ChartPieSliceIcon, tone: 'text-[#c93c35]' },
  { name: 'Design Report', about: 'Create documents with the Design Report template', from: 'From OpenAI Templates', Icon: ArticleIcon, tone: 'text-[#4358bc]' },
];

// Cursor, Stage and FileChip are shared with AgentScene.tsx (the Agents walkthrough, 2026-11-03).
export const Cursor = () => (
  <svg data-cursor viewBox="0 0 24 24" width="22" height="22" className="pointer-events-none absolute left-0 top-0 z-40 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" aria-hidden="true">
    <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

// Claude Code's pixel mascot, from its own icon, cropped to the drawing.
const Clawd = ({ className }: { className?: string }) => (
  <svg viewBox="0 5 24 15" className={className} aria-hidden="true">
    <path fill="#D97757" fillRule="evenodd" clipRule="evenodd" shapeRendering="crispEdges" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" />
  </svg>
);

// The app scenes are laid out once at 480x300 and scaled to the card, so a phone shows the same picture
// as a laptop, only smaller. The cursor and the file chip stay outside it, at the card's own scale.
const STAGE_W = 480;
export function Stage({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const card = box.current?.parentElement;
    if (!card) return;
    const fit = () => setK(card.clientWidth / STAGE_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  return <div ref={box} className="absolute left-0 top-0 h-[300px] w-[480px] origin-top-left overflow-hidden" style={{ transform: `scale(${k})` }}>{children}</div>;
}

// The downloaded file, as a small chip.
export const FileChip = ({ file, className }: { file: string; className?: string }) => (
  <div data-file className={cn('flex max-w-[78%] items-center gap-2 rounded-xl border border-line-2 bg-ink-3 px-3 py-2 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]', className)}>
    <FileTextIcon size={15} className="shrink-0 text-fg" /><span className="truncate text-[11.5px] text-fg">{file}</span><CheckIcon size={12} weight="bold" className="shrink-0 text-fg-2" />
  </div>
);

// A terminal's blinking-free block cursor.
const Caret = () => <span className="ml-px inline-block h-[1.1em] w-[0.6em] translate-y-[2px] bg-fg/80" />;

function useCopy() {
  const [ok, setOk] = useState(false);
  return { ok, copy: async (t: string) => { try { await navigator.clipboard.writeText(t); captureEvent('setup_ask_copied', {}); setOk(true); window.setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked */ } } };
}

export interface SetupHandle { replay: () => void }

// `file` is what the download saved (<slug>.md or a .zip); `folders` the skill folders it becomes.
// `title` and `about` are how the agents' skill menus list it (skillListing in skillExport.ts). `real` is
// false when there is no skill yet and the names are a stand-in: nothing is offered to copy then.
export const SetupScene = forwardRef<SetupHandle, { target: 'claude' | 'codex'; slug: string; name: string; real: boolean; title: string; about: string; file: string; folders: string[] }>(function SetupScene({ target, slug, name, real, title, about, file, folders }, ref) {
  const [mode, setMode] = useState<Mode>(target === 'codex' ? 'codexApp' : 'app');
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const scene = useRef<HTMLDivElement>(null);
  const spin = useRef<HTMLSpanElement>(null);
  const { ok, copy } = useCopy();
  useImperativeHandle(ref, () => ({ replay: () => setRun((r) => r + 1) }), []);

  const zip = file.endsWith('.zip');
  const list = stepsFor(mode, zip, file, real);
  // Codex's install command unzips into ~/.agents/skills, its folder for your own skills in every project.
  const base = mode === 'code' || mode === 'app' ? '~/.claude/skills' : '~/.agents/skills';
  const skills = folders.length ? folders : [slug];
  const skill = skills[0];
  const folder = `${base}/${skill}`;
  const command = zip ? `mkdir -p ${base} && unzip -o ~/Downloads/${file} -d ${base}` : `mkdir -p ${folder} && mv ~/Downloads/${slug}.md ${folder}/SKILL.md`;
  const dropped = `~/Downloads/${file}`;
  const terminal = mode === 'code' || mode === 'codex';
  // What to paste into Claude Code or Codex instead of dropping the file: the same ask, with the exact
  // file this download saved and where it belongs. An ask, not a shell command, because the agent then
  // runs the right command for the person's own system (Windows PowerShell has no unzip, and 5.1 no &&).
  const ask = mode === 'code'
    ? (zip ? `install the skill in ${dropped} into ~/.claude/skills` : `install this skill ${dropped} as ~/.claude/skills/${skill}/SKILL.md`)
    : `install the ${folders.length > 1 ? 'skills' : 'skill'} in ${dropped} into ~/.agents/skills`;

  // The replay arrow turns once, backwards, as the scene starts over.
  const replay = () => {
    setRun((r) => r + 1);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) spin.current?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-360deg)' }], { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  };

  // A layout effect, so the first frame is already the scene's opening state (no flash of the end state).
  useLayoutEffect(() => {
    const el = scene.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = gsap.utils.selector(el);
    // Cursor targets are measured from the live layout, so the scene scales with the card.
    const at = (sel: string) => {
      const box = el.getBoundingClientRect();
      const t = (q(sel)[0] as HTMLElement).getBoundingClientRect();
      return { x: t.left - box.left + t.width * 0.55, y: t.top - box.top + t.height * 0.55 };
    };
    const pulse = (sel: string) => gsap.fromTo(q(sel), { boxShadow: '0 0 0 0 rgba(255,255,255,0.45)' }, { boxShadow: '0 0 0 10px rgba(255,255,255,0)', duration: 0.6, ease: 'power2.out' });
    // The cursor glides to an element; `to` wraps it so a timeline reads as a list of moves.
    const point = (sel: string) => ({ x: () => at(sel).x, y: () => at(sel).y });
    // The file chip travels to an element. Inside a scaled Stage it moves in the stage's own units, so the
    // on-screen distance is divided by its scale (1 outside a Stage).
    const scale = () => { const f = q('[data-file]')[0] as HTMLElement; return f.getBoundingClientRect().width / f.offsetWidth || 1; };
    const fly = (sel: string) => ({ x: () => (at(sel).x - at('[data-file]').x) / scale(), y: () => (at(sel).y - at('[data-file]').y) / scale() });
    // A terminal keeps its newest line in view: the feed scrolls up once a line would pass the bottom. While
    // the downloaded file still sits in the corner, the line stays clear above it.
    const bottom = (sel: string) => () => {
      const feed = q('[data-feed]')[0] as HTMLElement;
      const line = q(sel)[0] as HTMLElement;
      const chip = q('[data-file]')[0] as HTMLElement | undefined;
      const reserve = chip && Number(gsap.getProperty(chip, 'opacity')) > 0.5 ? chip.offsetHeight + 10 : 0;
      return Math.min(0, (feed.parentElement as HTMLElement).clientHeight - (line.offsetTop + line.offsetHeight + 14 + reserve));
    };
    const follow = (sel: string) => ({ y: bottom(sel), duration: 0.3, ease: 'power2.out' });

    const ctx = gsap.context(() => {
      if (reduce) {
        // The finished frame, without the motion.
        setStep(list.length - 1);
        gsap.set(q('[data-file], [data-cursor], [data-ph]'), { autoAlpha: 0 });
        if (mode === 'app') {
          gsap.set(q('[data-side], [data-home]'), { autoAlpha: 0 });
          gsap.set(q('[data-cust], [data-new]'), { autoAlpha: 1, height: 'auto' });
          gsap.set(q('[data-count]'), { text: String(MINE.length + 1) });
        }
        if (terminal) {
          gsap.set(q('[data-line="2"]'), { text: mode === 'codex' ? 'codex' : 'claude' });
          gsap.set(q('[data-line="3"]'), { text: mode === 'codex' ? `$${skill} ` : `/${skill}` });
          if (mode === 'code') gsap.set(q('[data-dot]'), { color: '#4eba65' });
          // Codex's approval prompt and $ menu are passing moments, not part of the finished screen.
          if (mode === 'codex') gsap.set(q('[data-t="2"], [data-t="5"]'), { display: 'none' });
          gsap.set(q('[data-feed]'), { y: bottom('[data-feed] > :last-child')() });
        }
        if (mode === 'codexApp') {
          gsap.set(q('[data-cx-home]'), { autoAlpha: 0 });
          gsap.set(q('[data-cx-ask], [data-cx-reply]'), { autoAlpha: 1 });
          gsap.set(q('[data-mention]'), { text: `$${skill} ` });
        }
        return;
      }
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2, defaults: { ease: 'power3.inOut' } });
      tl.call(() => setStep(0));

      if (mode === 'app') {
        // Everything the loop moves goes back to its class-defined start.
        tl.set(q('[data-anim]'), { clearProps: 'all' })
          .set(q('[data-count]'), { text: String(MINE.length) })
          .set(q('[data-cursor]'), { x: el.clientWidth * 0.55, y: el.clientHeight * 0.55, autoAlpha: 0 })
          .fromTo(q('[data-file]'), { autoAlpha: 0, x: 0, y: 16, scale: 0.9 }, { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)' })
          .to({}, { duration: 0.5 })
          // Sidebar -> Customize: the sidebar slides away and the Customize page takes the window.
          .call(() => setStep(1))
          .to(q('[data-cursor]'), { autoAlpha: 1, duration: 0.2 })
          .to(q('[data-cursor]'), { ...point('[data-nav="customize"]'), duration: 0.9 })
          .add(() => { pulse('[data-nav="customize"]'); })
          .to(q('[data-nav="customize"]'), { backgroundColor: '#313130', duration: 0.2 }, '<')
          .to(q('[data-side]'), { x: -150, autoAlpha: 0, duration: 0.45 }, '+=0.25')
          .to(q('[data-home]'), { autoAlpha: 0, duration: 0.3 }, '<')
          .fromTo(q('[data-cust]'), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'expo.out' }, '<0.15')
          // Add -> Upload skill.
          .call(() => setStep(2))
          .to(q('[data-cursor]'), { ...point('[data-add]'), duration: 0.8 }, '+=0.2')
          .add(() => { pulse('[data-add]'); })
          .fromTo(q('[data-menu]'), { autoAlpha: 0, y: -4, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: 'expo.out' }, '+=0.05')
          .to(q('[data-cursor]'), { ...point('[data-upload-item]'), duration: 0.55 }, '+=0.2')
          .to(q('[data-upload-item]'), { backgroundColor: '#2b2b2a', duration: 0.15 }, '-=0.2')
          .add(() => { pulse('[data-upload-item]'); })
          .to(q('[data-menu]'), { autoAlpha: 0, duration: 0.15 }, '+=0.2')
          .to(q('[data-cust]'), { autoAlpha: 0, duration: 0.25 }, '<')
          .fromTo(q('[data-up]'), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'expo.out' })
          // The file is picked up and dropped on the drop area; Upload wakes up and runs the scan.
          .call(() => setStep(3))
          .to(q('[data-cursor]'), { ...point('[data-file]'), duration: 0.7 }, '+=0.2')
          .to(q('[data-file]'), { ...fly('[data-drop]'), scale: 0.9, duration: 0.85 }, '+=0.15')
          .to(q('[data-cursor]'), { ...point('[data-drop]'), duration: 0.85 }, '<')
          .to(q('[data-drop]'), { borderColor: '#c3c2b7', backgroundColor: 'rgba(255,255,255,0.04)', duration: 0.3 }, '-=0.35')
          .to(q('[data-file]'), { autoAlpha: 0, scale: 0.8, duration: 0.2 })
          .to(q('[data-dz-empty]'), { autoAlpha: 0, duration: 0.15 }, '<')
          .to(q('[data-dz-file]'), { autoAlpha: 1, duration: 0.25 })
          .to(q('[data-drop]'), { borderColor: '#444444', backgroundColor: 'rgba(255,255,255,0)', duration: 0.3 }, '<')
          .to(q('[data-hint]'), { autoAlpha: 0, duration: 0.2 }, '<')
          .to(q('[data-upbtn]'), { backgroundColor: '#e1e0d9', color: '#151515', duration: 0.25 }, '<')
          .to(q('[data-cursor]'), { ...point('[data-upbtn]'), duration: 0.6 }, '+=0.2')
          .add(() => { pulse('[data-upbtn]'); })
          .to(q('[data-scan-idle]'), { autoAlpha: 0, duration: 0.15 }, '+=0.1')
          .to(q('[data-scan-run]'), { autoAlpha: 1, duration: 0.15 }, '<')
          .to(q('[data-cursor]'), { autoAlpha: 0, duration: 0.3 }, '<0.2')
          .to({}, { duration: 1 })
          // Back on "Your skills", the new one joins the top of the list, and from here Claude just uses it.
          .to(q('[data-up]'), { autoAlpha: 0, duration: 0.25 })
          .fromTo(q('[data-cust]'), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'expo.out' })
          .fromTo(q('[data-new]'), { height: 0, autoAlpha: 0, filter: 'blur(4px)' }, { height: 'auto', autoAlpha: 1, filter: 'blur(0px)', duration: 0.55, ease: 'expo.out' }, '+=0.15')
          .set(q('[data-count]'), { text: String(MINE.length + 1) }, '<')
          .call(() => setStep(4), [], '+=0.5')
          .to({}, { duration: 2.2 });
      } else if (mode === 'codexApp') {
        // Drop the ZIP on the composer, ask, send: Codex installs it in the chat, then $ finds it.
        tl.set(q('[data-anim]'), { clearProps: 'all' })
          .set(q('[data-typed], [data-mention]'), { text: '' })
          .set(q('[data-cursor]'), { x: el.clientWidth * 0.55, y: el.clientHeight * 0.55, autoAlpha: 0 })
          .fromTo(q('[data-file]'), { autoAlpha: 0, x: 0, y: 16, scale: 0.9 }, { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)' })
          .to({}, { duration: 0.5 })
          .call(() => setStep(1))
          .to(q('[data-cursor]'), { autoAlpha: 1, duration: 0.2 })
          .to(q('[data-cursor]'), { ...point('[data-file]'), duration: 0.8 })
          // The ZIP is dragged onto the composer and becomes an attachment there.
          .call(() => setStep(2), [], '+=0.15')
          .to(q('[data-file]'), { ...fly('[data-ph]'), scale: 0.9, duration: 0.85 })
          .to(q('[data-cursor]'), { ...point('[data-ph]'), duration: 0.85 }, '<')
          .to(q('[data-composer]'), { borderColor: '#8a847b', duration: 0.3 }, '-=0.35')
          .to(q('[data-file]'), { autoAlpha: 0, scale: 0.8, duration: 0.2 })
          .to(q('[data-ph]'), { autoAlpha: 0, duration: 0.1 }, '<')
          .set(q('[data-attach]'), { display: 'flex' })
          .fromTo(q('[data-attach]'), { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, '<')
          .to(q('[data-composer]'), { borderColor: '#45413c', duration: 0.3 }, '<')
          .to(q('[data-typed]'), { text: 'install this skill', duration: 0.7, ease: 'none' }, '+=0.2')
          .to(q('[data-cursor]'), { ...point('[data-send]'), duration: 0.6 }, '+=0.15')
          .add(() => { pulse('[data-send]'); })
          .to(q('[data-send]'), { backgroundColor: '#5b5fc7', color: '#ffffff', duration: 0.15 }, '<')
          // Sent: the home screen gives way to the chat, and Codex answers once it is installed.
          .to(q('[data-cx-home]'), { autoAlpha: 0, duration: 0.25 }, '+=0.1')
          .fromTo(q('[data-cx-ask]'), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'expo.out' }, '<0.1')
          .set(q('[data-attach]'), { display: 'none' }, '<')
          .set(q('[data-typed]'), { text: '' }, '<')
          .to(q('[data-send]'), { backgroundColor: '#404375', color: '#9c9b90', duration: 0.2 }, '<')
          .to(q('[data-ph]'), { autoAlpha: 1, duration: 0.2 }, '<0.1')
          .to(q('[data-cursor]'), { autoAlpha: 0, duration: 0.2 }, '<')
          .set(q('[data-cx-reply]'), { autoAlpha: 1 }, '+=0.7')
          .fromTo(q('[data-cx-reply] > *'), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.55, ease: 'expo.out' }, '<')
          // $ in the composer opens the skills menu, and the new skill is at the top.
          .call(() => setStep(3), [], '+=0.8')
          .to(q('[data-cursor]'), { autoAlpha: 1, duration: 0.2 })
          .to(q('[data-cursor]'), { ...point('[data-ph]'), duration: 0.7 }, '<')
          .to(q('[data-ph]'), { autoAlpha: 0, duration: 0.1 }, '+=0.15')
          .to(q('[data-mention]'), { text: '$', duration: 0.05, ease: 'none' }, '<')
          .fromTo(q('[data-picker]'), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'expo.out' }, '+=0.1')
          .to(q('[data-cursor]'), { ...point('[data-pick]'), duration: 0.6 }, '+=0.5')
          .add(() => { pulse('[data-pick]'); })
          .to(q('[data-picker]'), { autoAlpha: 0, duration: 0.2 }, '+=0.25')
          .set(q('[data-mention]'), { text: `$${skill} ` }, '<')
          .to(q('[data-cursor]'), { autoAlpha: 0, duration: 0.3 }, '+=0.5')
          .to({}, { duration: 1.8 });
      } else if (mode === 'code') {
        tl.set(q('[data-line]'), { text: '' })
          .set(q('[data-out]'), { autoAlpha: 0 })
          .set(q('[data-t]'), { display: 'none', autoAlpha: 0 })
          .set(q('[data-dot]'), { clearProps: 'color' })
          .set(q('[data-feed]'), { y: 0 })
          .fromTo(q('[data-file]'), { autoAlpha: 0, x: 0, y: 12, scale: 1 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' })
          .to({}, { duration: 0.4 })
          // Claude Code opens first, on its welcome screen.
          .call(() => setStep(1))
          .to(q('[data-line="2"]'), { text: 'claude', duration: 0.35, ease: 'none' })
          .to(q('[data-out="2"]'), { autoAlpha: 1, duration: 0.25 }, '+=0.35')
          .to(q('[data-out="3"]'), { autoAlpha: 1, duration: 0.2 }, '+=0.25')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          // The file is dropped on the prompt (a terminal pastes its path) with a short ask.
          .call(() => setStep(2), [], '+=0.5')
          .to(q('[data-line="3"]'), { text: 'install this skill ', duration: 0.6, ease: 'none' })
          .to(q('[data-file]'), { ...fly('[data-out="3"]'), scale: 0.85, autoAlpha: 0, duration: 0.75, ease: 'power2.in' }, '+=0.2')
          .add(() => { pulse('[data-out="3"]'); })
          .set(q('[data-line="3"]'), { text: `install this skill ${dropped}` })
          .to({}, { duration: 0.6 })
          // Enter: the prompt joins the conversation and Claude does the install itself.
          .set(q('[data-line="3"]'), { text: '' })
          .set(q('[data-t="1"]'), { display: 'block' })
          .to(q('[data-t="1"]'), { autoAlpha: 1, duration: 0.2 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          .set(q('[data-t="2"]'), { display: 'flex' }, '+=0.45')
          .to(q('[data-t="2"]'), { autoAlpha: 1, duration: 0.2 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          .to(q('[data-dot]'), { color: '#4eba65', duration: 0.2 }, '+=0.6')
          .set(q('[data-t="3"]'), { display: 'block' }, '<')
          .to(q('[data-t="3"]'), { autoAlpha: 1, duration: 0.2 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          .set(q('[data-t="4"]'), { display: 'flex' }, '+=0.45')
          .to(q('[data-t="4"]'), { autoAlpha: 1, duration: 0.25 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          // / lists it, at the bottom of the prompt.
          .call(() => setStep(3), [], '+=0.6')
          .to(q('[data-line="3"]'), { text: `/${skill.slice(0, 3)}`, duration: 0.25, ease: 'none' })
          .to(q('[data-out="4"]'), { autoAlpha: 1, duration: 0.2 })
          .to(q('[data-feed]'), follow('[data-out="4"]'), '<')
          .to(q('[data-line="3"]'), { text: `/${skill}`, duration: Math.max(0.2, (skill.length - 3) * 0.045), ease: 'none' }, '+=0.2')
          .to({}, { duration: 2.2 });
      } else {
        // Codex CLI, in the same order as Claude Code: open it, drop the ZIP in, approve the unzip, find it
        // with $. While Codex waits for the approval, its prompt replaces the composer, as in the real TUI.
        tl.set(q('[data-line]'), { text: '' })
          .set(q('[data-out]'), { autoAlpha: 0, clearProps: 'display' })
          .set(q('[data-t]'), { display: 'none', autoAlpha: 0 })
          .set(q('[data-ph]'), { autoAlpha: 1 })
          .set(q('[data-feed]'), { y: 0 })
          .fromTo(q('[data-file]'), { autoAlpha: 0, x: 0, y: 12, scale: 1 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' })
          .to({}, { duration: 0.4 })
          .call(() => setStep(1))
          .to(q('[data-line="2"]'), { text: 'codex', duration: 0.35, ease: 'none' })
          .to(q('[data-out="2"]'), { autoAlpha: 1, duration: 0.25 }, '+=0.35')
          .to(q('[data-out="3"]'), { autoAlpha: 1, duration: 0.2 }, '+=0.25')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          .call(() => setStep(2), [], '+=0.5')
          .to(q('[data-ph]'), { autoAlpha: 0, duration: 0.1 })
          .to(q('[data-line="3"]'), { text: 'install this skill ', duration: 0.6, ease: 'none' })
          .to(q('[data-file]'), { ...fly('[data-out="3"]'), scale: 0.85, autoAlpha: 0, duration: 0.75, ease: 'power2.in' }, '+=0.2')
          .add(() => { pulse('[data-out="3"]'); })
          .set(q('[data-line="3"]'), { text: `install this skill ${dropped}` })
          .to({}, { duration: 0.6 })
          .set(q('[data-line="3"]'), { text: '' })
          .set(q('[data-t="1"]'), { display: 'block' })
          .to(q('[data-t="1"]'), { autoAlpha: 1, duration: 0.2 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          // Writing outside the project needs a yes: the approval prompt takes the composer's place.
          .set(q('[data-out="3"]'), { display: 'none' }, '+=0.5')
          .set(q('[data-t="2"]'), { display: 'block' }, '<')
          .to(q('[data-t="2"]'), { autoAlpha: 1, duration: 0.25 }, '<')
          .to(q('[data-feed]'), follow('[data-t="2"]'), '<')
          .add(() => { pulse('[data-yes]'); }, '+=1')
          .set(q('[data-t="2"]'), { display: 'none' }, '+=0.45')
          .set(q('[data-t="3"]'), { display: 'block' }, '<')
          .to(q('[data-t="3"]'), { autoAlpha: 1, duration: 0.2 }, '<')
          .set(q('[data-out="3"]'), { display: 'block' }, '<')
          .set(q('[data-ph]'), { autoAlpha: 1 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          .set(q('[data-t="4"]'), { display: 'block' }, '+=0.5')
          .to(q('[data-t="4"]'), { autoAlpha: 1, duration: 0.25 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          // $ and the start of its name: the skill menu opens above the composer; enter inserts it.
          .call(() => setStep(3), [], '+=0.6')
          .to(q('[data-ph]'), { autoAlpha: 0, duration: 0.1 })
          .to(q('[data-line="3"]'), { text: `$${skill.slice(0, 3)}`, duration: 0.25, ease: 'none' }, '<')
          .set(q('[data-t="5"]'), { display: 'block' })
          .to(q('[data-t="5"]'), { autoAlpha: 1, duration: 0.2 }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          .set(q('[data-t="5"]'), { display: 'none' }, '+=1.2')
          .set(q('[data-line="3"]'), { text: `$${skill} ` }, '<')
          .to(q('[data-feed]'), follow('[data-out="3"]'), '<')
          .to({}, { duration: 2.2 });
      }
    }, el);
    return () => ctx.revert();
  }, [mode, run, command, skill, dropped, terminal, list.length]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* The same sliding pill as the Claude / Codex switch above it. */}
        <div role="radiogroup" aria-label="Where you use it" className="relative inline-flex rounded-full border border-line bg-ink-2 p-1">
          <SlidingThumb value={mode} className="inset-y-1 bg-white" />
          {TABS[target].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn('relative z-[1] rounded-full px-3.5 py-1 text-[13.5px] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-white/60', mode === k ? 'text-black' : 'text-fg-2 hover:text-fg')}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={replay} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] text-fg-2 hover:text-fg"><span ref={spin} className="inline-flex"><ArrowCounterClockwiseIcon size={14} /></span>Replay</button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-center">
        <div ref={scene} className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-ink" aria-hidden="true">
          {(mode === 'app' || mode === 'codexApp') && <Cursor />}
          {mode === 'app' ? (
            <>
              {/* The Claude app, coloured from the real one (Windows, 2026-10-19 screenshots): a near-black
                  window, the warm grey sidebar, Customize with its serif title, and the Upload a skill page.
                  The list, project and account are stand-ins, nothing from anyone's own account. */}
              <Stage>
                <div className="absolute inset-0 bg-[#151515] text-[#f0efec]">
                  <div className="absolute inset-x-0 top-0 z-10 flex h-[30px] items-center gap-2.5 px-3 text-[#898781]">
                    <span className="size-2 rounded-full bg-white/15" /><span className="size-2 rounded-full bg-white/15" /><span className="size-2 rounded-full bg-white/15" />
                    <SidebarSimpleIcon size={13} className="ml-1.5" /><ArrowLeftIcon size={12} /><ArrowRightIcon size={12} className="opacity-50" />
                    <span className="ml-1 flex items-center gap-1.5 text-[11px]"><ClaudeLogo size={11} />Claude</span>
                  </div>

                  <div data-anim data-side className="absolute bottom-0 left-0 top-[30px] flex w-[150px] flex-col border-r border-[#373736] bg-[#20201f] px-2 pt-1 text-[11px] text-[#c3c2b7]">
                    <div className="flex h-[22px] items-center gap-1.5 rounded-md border border-[#373736] bg-[#2b2b2a] px-2 text-[10.5px] text-[#898781]"><MagnifyingGlassIcon size={11} />Search</div>
                    <div className="mt-1.5 flex h-[22px] items-center gap-2 rounded-md bg-[#414140] px-2 text-[#f0efec]"><PlusIcon size={11} />New</div>
                    <div className="flex h-[22px] items-center gap-2 px-2"><StackIcon size={11} />Projects<span className="rounded bg-[#274c79] px-1 text-[8.5px] leading-[13px] text-[#a9cdf7]">New</span></div>
                    <div className="flex h-[22px] items-center gap-2 px-2"><ShapesIcon size={11} />Artifacts</div>
                    <div data-anim data-nav="customize" className="flex h-[22px] items-center gap-2 rounded-md px-2"><ToolboxIcon size={11} />Customize</div>
                    <div className="flex h-[22px] items-center gap-2 px-2"><DotsThreeIcon size={11} />More</div>
                    <p className="mt-3 px-2 text-[9.5px] text-[#898781]">my-project</p>
                    <p className="truncate px-2 py-1 text-[10.5px]">Plan the launch checklist</p>
                    <div className="mt-auto flex items-center gap-2 border-t border-[#373736] px-1 py-2 text-[10.5px]"><span className="grid size-[18px] place-items-center rounded-full bg-[#414140] text-[9px] text-[#f0efec]">Y</span>You</div>
                  </div>

                  <div data-anim data-home className="absolute bottom-0 left-[150px] right-0 top-[30px]">
                    <div className="absolute inset-x-[22px] bottom-[32px]">
                      <Clawd className="absolute -top-[13px] right-[16px] h-[13px] w-[21px]" />
                      <div className="flex h-[30px] items-center gap-2 rounded-[10px] border border-[#373736] bg-[#20201f] px-2.5 text-[10.5px] text-[#898781]">
                        <PlusIcon size={11} className="text-[#c3c2b7]" /><span className="flex-1 truncate">Describe a task or ask a question</span><MicrophoneIcon size={11} className="text-[#c3c2b7]" />
                      </div>
                    </div>
                    <div className="absolute inset-x-[26px] bottom-[11px] flex items-center gap-2.5 whitespace-nowrap text-[9px] text-[#c3c2b7]">
                      <span className="flex items-center gap-1"><LaptopIcon size={10} />This computer</span>
                      <span className="flex items-center gap-1"><FolderSimpleIcon size={10} />my-project</span>
                      <span>Auto</span>
                      <span className="ml-auto">Opus 5.5 <span className="text-[#898781]">High</span></span>
                    </div>
                  </div>

                  <div data-anim data-cust className="invisible absolute inset-x-0 bottom-0 top-[30px] px-[34px] pt-[12px]">
                    <h3 className="font-serif text-[21px] tracking-[-0.01em]">Customize</h3>
                    <div className="mt-2.5 flex items-center gap-1 whitespace-nowrap text-[10.5px]">
                      <span className="rounded-md bg-[#262626] px-2 py-1">Skills</span>
                      <span className="px-1.5 py-1 text-[#898781]">Connectors</span>
                      <span className="px-1.5 py-1 text-[#898781]">Plugins</span>
                      <span className="mx-1.5 h-3.5 w-px bg-[#373736]" />
                      <span className="flex rounded-md bg-[#212121] p-0.5"><span className="rounded bg-[#383838] px-2 py-0.5">Yours</span><span className="px-2 py-0.5 text-[#898781]">Discover</span></span>
                      <span data-anim data-add className="ml-auto flex items-center gap-1 rounded-md bg-[#e1e0d9] px-2 py-1 font-medium text-[#151515]"><PlusIcon size={10} weight="bold" />Add<CaretDownIcon size={8} /></span>
                    </div>
                    <p className="mt-3.5 flex items-center gap-1.5 text-[11px] font-medium">Created by you<span data-count className="rounded bg-[#21214c] px-1 text-[9px] leading-[14px] text-[#b4b4f0]">{MINE.length}</span></p>
                    <div className="mt-1">
                      <div data-anim data-new className="invisible h-0 overflow-hidden">
                        <div className="flex h-[38px] items-center gap-2.5 rounded-md border-b border-[#2d2d2d] bg-white/[0.04] px-1">
                          <span className="grid size-[24px] shrink-0 place-items-center rounded-md border border-[#373736] bg-[#0b0b0b]"><ScrollIcon size={12} /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{name}</span><span className="block truncate text-[9.5px] text-[#898781]">by you · {about}</span></span>
                          <span className="text-[9px] text-[#787671]">Today</span><DotsThreeVerticalIcon size={11} className="text-[#898781]" />
                        </div>
                      </div>
                      {MINE.map((m) => (
                        <div key={m.name} className="flex h-[38px] items-center gap-2.5 border-b border-[#2d2d2d] px-1">
                          <span className="grid size-[24px] shrink-0 place-items-center rounded-md border border-[#373736] bg-[#0b0b0b]"><ScrollIcon size={12} /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{m.name}</span><span className="block truncate text-[9.5px] text-[#898781]">by you · {m.about}</span></span>
                          <span className="text-[9px] text-[#787671]">{m.when}</span><DotsThreeVerticalIcon size={11} className="text-[#898781]" />
                        </div>
                      ))}
                    </div>
                    <div data-anim data-menu className="invisible absolute right-[34px] top-[76px] w-[140px] rounded-lg border border-[#373736] bg-[#20201f] p-1 text-[10.5px] shadow-[0_14px_30px_-10px_rgba(0,0,0,0.9)]">
                      <div data-anim data-upload-item className="flex items-center gap-2 rounded-md px-2 py-1.5"><UploadSimpleIcon size={11} />Upload skill</div>
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[#c3c2b7]"><PencilSimpleIcon size={11} />Create a skill</div>
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[#c3c2b7]"><ChatCircleIcon size={11} />Create with Claude</div>
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[#c3c2b7]"><VideoCameraIcon size={11} />Record your screen</div>
                    </div>
                  </div>

                  <div data-anim data-up className="invisible absolute inset-x-0 bottom-0 top-[30px] px-[34px] pt-[10px]">
                    <p className="flex items-center gap-1 text-[10.5px] text-[#c3c2b7]"><ArrowLeftIcon size={10} />Your skills</p>
                    <h3 className="mt-1.5 text-[16px] font-semibold tracking-[-0.01em]">Upload a skill</h3>
                    <p className="mt-0.5 text-[10px] text-[#c3c2b7]">Add a skill to your workspace. A security scan runs when you upload.</p>
                    <p className="mt-2.5 text-[10px] font-medium">Skill file</p>
                    <div data-anim data-drop className="relative mt-1.5 grid h-[52px] place-items-center rounded-lg border border-dashed border-[#444444]">
                      <div data-anim data-dz-empty className="flex flex-col items-center gap-1 text-[10px] text-[#c3c2b7]"><UploadSimpleIcon size={12} />Drag and drop skill files here, or browse</div>
                      <div data-anim data-dz-file className="invisible absolute inset-0 flex items-center gap-2 px-3 text-[10.5px]"><FileTextIcon size={13} className="shrink-0" /><span className="truncate">{file}</span><CheckIcon size={10} weight="bold" className="ml-auto shrink-0 text-[#898781]" /></div>
                    </div>
                    <ul className="mt-1.5 list-disc pl-4 text-[9px] leading-[1.5] text-[#898781]">
                      <li>.md file must contain skill name and description formatted in YAML</li>
                      <li>.zip or .skill file must include a SKILL.md file</li>
                    </ul>
                    <div className="mt-2 flex h-[30px] items-center justify-between rounded-lg border border-[#2d2d2d] px-3 text-[10.5px]">
                      Security scan
                      <span className="relative text-[9.5px] text-[#898781]">
                        <span data-anim data-scan-idle>Runs when you upload</span>
                        <span data-anim data-scan-run className="invisible absolute inset-y-0 right-0 flex items-center gap-1 whitespace-nowrap"><CircleNotchIcon size={10} className="animate-spin" />Scanning</span>
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 text-[10.5px]">
                      <span data-anim data-upbtn className="rounded-md bg-[#6f6f6f] px-2.5 py-1 text-[#262626]">Upload</span>
                      <span className="rounded-md bg-[#2d2d2d] px-2.5 py-1">Cancel</span>
                      <span data-anim data-hint className="text-[9.5px] text-[#898781]">Choose a file to continue.</span>
                    </div>
                  </div>
                  {/* The download, top right like a browser's download bubble: clear of every page's content. */}
                  <FileChip file={file} className="absolute right-[14px] top-[38px] z-30" />
                </div>
              </Stage>
            </>
          ) : mode === 'codexApp' ? (
            <>
              {/* The Codex app home, coloured from the real app (sampled from a screenshot, 2026-10-18): slate
                  window chrome and icon rail, a warm near-black canvas, the stone composer with its folder tab.
                  The project is a stand-in, nothing from anyone's own account. */}
              <Stage>
                <div className="absolute inset-0 bg-[#1a1816]">
                  <div className="absolute inset-x-0 top-0 flex h-[30px] items-center gap-2 border-b border-white/[0.06] bg-[#1a2227] px-3">
                    <span className="size-2 rounded-full bg-white/15" /><span className="size-2 rounded-full bg-white/15" /><span className="size-2 rounded-full bg-white/15" />
                    <span className="ml-2 flex items-center gap-1.5 text-[11px] text-[#939089]"><CodexOutline size={12} />Codex</span>
                  </div>
                  <div className="absolute bottom-0 left-0 top-[30px] flex w-[38px] flex-col items-center gap-1.5 bg-[#1d2124] pt-2 text-[#939089]">
                    <span className="grid size-[24px] place-items-center rounded-md bg-[#2d3337] text-[#ffffed]"><HouseIcon size={13} weight="fill" /></span>
                    {[ClockIcon, BooksIcon, PuzzlePieceIcon, DotsThreeIcon].map((Icon, n) => <span key={n} className="grid size-[24px] place-items-center"><Icon size={13} /></span>)}
                  </div>
                  <div className="absolute bottom-0 left-[38px] right-0 top-[30px]">
                    <div data-anim data-cx-home className="absolute inset-x-0 top-[44px] flex flex-col items-center gap-2.5 px-4 text-center">
                      <CodexOutline size={28} className="text-[#5f5e57]" />
                      <p className="text-[14px] tracking-[-0.01em] text-[#ebebdb]">What should we work on in <span className="underline decoration-[#777169] decoration-dotted underline-offset-[3px]">my-project</span>?</p>
                    </div>

                    {/* The chat once it is sent: the ask with its ZIP on the right, Codex's answer on the left. */}
                    <div className="absolute inset-x-[28px] top-[16px] space-y-3">
                      <div data-anim data-cx-ask className="invisible ml-auto w-fit max-w-[80%] rounded-2xl bg-[#2f2d29] px-3 py-2">
                        <span className="mb-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-lg bg-[#393632] px-2 py-1 text-[10px] text-[#cbcabc]"><FileTextIcon size={11} className="shrink-0" /><span className="truncate">{file}</span></span>
                        <p className="text-[11px] text-[#ffffed]">install this skill</p>
                      </div>
                      <div data-anim data-cx-reply className="invisible space-y-1 text-[11px] leading-snug">
                        <p className="text-[#817b72]">Unzipped {file} into your skills</p>
                        <p className="text-[#ebebdb]">Installed {title}. Type <span className="text-[#b1a9ff]">${skill}</span> to use it.</p>
                      </div>
                    </div>

                    <div className="absolute inset-x-[28px] bottom-[14px]">
                      <div className="mx-2 flex items-center gap-1.5 rounded-t-[10px] bg-[#2a2824] px-2.5 pb-1 pt-1.5 text-[10px] text-[#ffffed]"><FolderSimpleIcon size={11} />my-project</div>
                      <div data-composer className="relative rounded-[14px] border border-[#45413c] bg-[#393632] px-3 pb-2 pt-2.5">
                        {/* The $ menu, as in the real app: full width over the folder tab, a skill icon, its name,
                            the description, and where it comes from. Ours is a Local file. */}
                        <div data-anim data-picker className="invisible absolute inset-x-0 bottom-[calc(100%+5px)] z-10 rounded-[14px] border border-[#413e3a] bg-[#2f2d29] p-1 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.8)]">
                          {[{ name: title, about, from: 'Local file', Icon: CubeIcon, tone: 'text-[#ffffed]' }, ...CODEX_MENU].map((m, n) => (
                            <div key={m.name} data-pick={n === 0 ? '' : undefined} className={cn('flex items-center gap-2 whitespace-nowrap rounded-[9px] px-2 py-[5px] text-[10.5px]', n === 0 && 'bg-[#403d39]')}>
                              <m.Icon size={12} className={cn('shrink-0', m.tone)} />
                              <span className={cn('shrink-0', n === 0 ? 'text-[#ffffed]' : 'text-[#cbcabc]')}>{m.name}</span>
                              <span className={cn('min-w-0 flex-1 truncate', n === 0 ? 'text-[#a69e93]' : 'text-[#817b72]')}>{m.about}</span>
                              <span className={cn('shrink-0 text-[9.5px]', n === 0 ? 'text-[#a69e93]' : 'text-[#817b72]')}>{m.from}</span>
                            </div>
                          ))}
                        </div>
                        <p className="relative flex h-5 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] leading-4">
                          <span data-anim data-ph className="absolute left-0 top-0.5 text-[#777169]">Do anything</span>
                          <span data-anim data-attach className="hidden min-w-0 max-w-[60%] shrink items-center gap-1 rounded-md bg-[#2f2d29] px-1.5 py-0.5 text-[10px] text-[#cbcabc]"><FileTextIcon size={10} className="shrink-0" /><span className="truncate">{file}</span></span>
                          <span data-typed className="shrink-0 text-[#ffffed]" />
                          <span data-mention className="shrink-0 text-[#b1a9ff]" />
                        </p>
                        <div className="mt-3 flex items-center gap-2.5 text-[10px] text-[#a29a8f]">
                          <PlusIcon size={12} className="text-[#ffffed]" />
                          <span className="flex items-center gap-1 whitespace-nowrap"><HandIcon size={11} />Ask for approval</span>
                          <span className="ml-auto flex items-center gap-1 whitespace-nowrap"><span className="text-[#ffffed]">6 Luna</span>Medium<CaretDownIcon size={9} /></span>
                          <MicrophoneIcon size={12} className="text-[#ffffed]" />
                          <span data-anim data-send className="grid size-[20px] shrink-0 place-items-center rounded-full bg-[#404375] text-[#9c9b90]"><ArrowUpIcon size={11} weight="bold" /></span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* The download, top right like a browser's download bubble, as in the Claude app scene. */}
                  <FileChip file={file} className="absolute right-[14px] top-[38px] z-30" />
                </div>
              </Stage>
            </>
          ) : (
            // The terminals stay black, like a real one.
            <div className="absolute inset-0 flex flex-col">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="size-2 rounded-full bg-white/15" /><span className="size-2 rounded-full bg-white/15" /><span className="size-2 rounded-full bg-white/15" />
                <span className="ml-2 font-mono text-[11px] text-fg-3">Terminal</span>
              </div>
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {mode === 'code' ? (
                  <div data-feed className="relative space-y-2 p-3.5 font-mono text-[11.5px] leading-relaxed">
                    <p className="text-fg"><span className="text-fg-3">$ </span><span data-line="2" /></p>
                    {/* Claude Code's welcome as it opens, with a stand-in project folder (nothing from an account) */}
                    <div data-out="2" className="flex items-center gap-3 py-1">
                      <Clawd className="h-[44px] w-[70px] shrink-0" />
                      <div className="min-w-0 leading-snug">
                        <p className="truncate"><span className="font-semibold text-fg">Claude Code</span> <span className="text-fg-3">v2.1.302</span></p>
                        <p className="truncate text-fg-3">Opus 5.5 · Claude Pro</p>
                        <p className="truncate text-fg-3">~/projects/my-app</p>
                      </div>
                    </div>
                    {/* The conversation: the ask with the dropped path, Claude's install, its reply */}
                    <p data-t="1" className="break-all text-fg-3">&gt; install this skill {dropped}</p>
                    <p data-t="2" className="flex min-w-0 gap-2 text-fg"><span data-dot className="shrink-0 text-fg-3">●</span><span className="min-w-0 truncate"><span className="font-semibold">Bash</span>({command})</span></p>
                    <p data-t="3" className="pl-[1.6em] text-fg-3">⎿&nbsp;&nbsp;3 Contents found</p>
                    <p data-t="4" className="flex gap-2 text-fg"><span className="shrink-0">●</span><span className="min-w-0">Installed. It's ready as /{skill}.</span></p>
                    <div data-out="3" className="break-all border-y border-white/20 py-1 text-fg">
                      <span className="text-fg-3">&gt; </span><span data-line="3" /><Caret />
                    </div>
                    <p data-out="4" className="flex gap-4 pl-2"><span className="shrink-0 text-[#b1b9f9]">/{skill}</span><span className="min-w-0 truncate text-fg-3">{about}</span></p>
                  </div>
                ) : (
                  <div data-feed className="relative space-y-2 p-3.5 font-mono text-[11.5px] leading-relaxed">
                    <p className="text-fg"><span className="text-fg-3">$ </span><span data-line="2" /></p>
                    {/* Codex's welcome box and first tips as it opens (OpenAI's Codex CLI docs and the TUI's own
                        startup header, 2026-10), with a stand-in project folder */}
                    <div data-out="2" className="space-y-2.5">
                      <div className="w-fit max-w-full rounded-md border border-white/25 px-3 py-1.5 leading-snug">
                        <p className="overflow-hidden text-ellipsis whitespace-pre"><span className="text-fg-3">&gt;_ </span><span className="font-semibold text-fg">OpenAI Codex</span><span className="text-fg-3"> (v0.143.0)</span></p>
                        <p className="mt-[1.375em] overflow-hidden text-ellipsis whitespace-pre"><span className="text-fg-3">model:     </span><span className="text-fg">gpt-6.1-sol medium</span><span className="text-fg-3">   /model to change</span></p>
                        <p className="overflow-hidden text-ellipsis whitespace-pre"><span className="text-fg-3">directory: </span><span className="text-fg">~/projects/my-app</span></p>
                      </div>
                      <div className="space-y-0.5 pl-2 leading-snug text-fg-3">
                        <p>To get started, describe a task or try one of these commands:</p>
                        <p className="pt-1.5"><span className="text-fg">/init</span> - create an AGENTS.md file with instructions for Codex</p>
                        <p><span className="text-fg">/status</span> - show current session configuration</p>
                      </div>
                    </div>
                    {/* The conversation, in Codex's own marks: › for what you sent, • for Codex, └ for output */}
                    <p data-t="1" className="break-all bg-white/[0.06] px-1.5 text-fg"><span className="text-fg-3">› </span>install this skill {dropped}</p>
                    <div data-t="2" className="space-y-1.5 pl-2">
                      <p className="font-semibold text-fg">Would you like to run the following command?</p>
                      <p className="break-all pl-2"><span className="text-[#89b4fa]">$ </span><span className="text-[#cdd6f4]">{command}</span></p>
                      <p data-yes className="w-fit bg-fg px-1 font-semibold text-black">› 1. Yes, proceed (y)</p>
                      <p className="pl-[1.2em] text-fg-2">2. No, and tell Codex what to do differently (esc)</p>
                    </div>
                    <div data-t="3">
                      <p className="break-all"><span className="text-[#5fb36f]">• </span><span className="font-semibold text-fg">Ran</span> <span className="text-fg-2">{command}</span></p>
                      <p className="break-all pl-[1.2em] text-fg-3">└ inflating: {base}/{skill}/SKILL.md</p>
                    </div>
                    <p data-t="4" className="text-fg"><span className="text-fg-3">• </span>Installed. Type ${skill} to use it.</p>
                    <div data-t="5" className="space-y-1">
                      <p className="flex gap-2 overflow-hidden whitespace-nowrap"><span className="shrink-0 font-semibold text-fg">› {title}</span><span className="shrink-0 text-fg-3">[Skill]</span><span className="min-w-0 truncate text-fg-2">{about}</span></p>
                      <p className="pl-[1.2em] text-fg-3">enter insert · esc close</p>
                    </div>
                    <div data-out="3">
                      <p className="relative break-all text-fg">
                        <span className="font-semibold">› </span><span data-ph className="absolute left-[2em] top-0 whitespace-nowrap text-fg-3">Ask Codex to do anything</span><span data-line="3" className="text-[#b1a9ff]" /><Caret />
                      </p>
                      <p className="mt-1 text-right text-[10.5px] text-fg-3">100% context left</p>
                    </div>
                  </div>
                )}
              </div>
              <FileChip file={dropped} className="absolute bottom-3 right-3 z-10" />
            </div>
          )}
        </div>

        <div>
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
          {terminal && (real ? (
            // Copies the ask with this download's exact file name (the line itself isn't shown: Manas found
            // the long preview box ugly, 2026-10-19). Pasted into Claude Code or Codex, it installs the skill.
            <button type="button" onClick={() => copy(ask)} className="mt-5 inline-flex items-center gap-2 rounded-full border border-line-2 px-4 py-2 text-[13.5px] text-fg hover:bg-white/[0.06]">
              {ok ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}{ok ? 'Command copied' : 'Or copy the install command'}
            </button>
          ) : (
            <p className="mt-5 text-[12.5px] leading-snug text-fg-3">Make a skill and download it, and this shows the exact line to paste for it.</p>
          ))}
        </div>
      </div>
    </div>
  );
});
