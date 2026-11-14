// The workspace's left rail. It is not there on the intro screen: it arrives when the first skill starts
// building, and from then on Relatch is an app with a place to come back to. It lists the skills this
// person has made (the finished files only, see useSkillHistory) with the one being written on top,
// and carries the install guide and the settings.
// "Your skills" is an account's: someone on the free try sees no list, only a line saying the try is
// not kept (V3App keeps nothing for them and passes no skills).
//
// On a wide screen it is a fixed column that can be closed; under 1024px it is a drawer that slides over
// the page.
import { useLayoutEffect, useRef, useState } from 'react';
import { Show, UserButton, useUser } from '@clerk/react';
import { ArrowLeftIcon, ArrowsLeftRightIcon, ArrowUpRightIcon, CaretRightIcon, ClockCounterClockwiseIcon, DownloadSimpleIcon, GearSixIcon, LinkSimpleIcon, PlayCircleIcon, PlusIcon, SidebarSimpleIcon, TrashIcon, WavesIcon, XIcon } from '@phosphor-icons/react';
import { RelatchMark } from './RelatchMark';
import { TARGET_NAME, TargetLogo } from './logos';
import { Modal } from './Modal';
import { Segmented } from './SlidingThumb';
import { useDismiss } from './useDismiss';
import { resetTime, usePlan } from './usePlan';
import { downloadAll } from './skillExport';
import type { SavedSkill } from './useSkillHistory';
import { ANON_TRIAL_USED_KEY } from '@/engine/core';
import { cn } from '@/lib/utils';

import type { Target } from './skillExport';
type Filter = 'all' | Target;

function ago(t: number) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

const row = (active: boolean) => cn('group/row relative flex h-9 items-center rounded-lg transition-colors', active ? 'bg-white/[0.08] text-fg' : 'text-fg-2 hover:bg-white/[0.04] hover:text-fg');
const ring = 'focus-visible:outline-2 focus-visible:outline-white/60';
const iconButton = cn('grid size-9 shrink-0 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg', ring);

// 2026-11-14 settings redesign (Manas: uneven spacing, rows not arranged professionally): every section
// is one grouped card, the rows inside it share one height, one inset and one 16px icon column, and
// hairlines divide them. The section label lines up with the text inside its card (12px padding + the 1px border).
const heading = 'px-[13px] pb-2 text-[12px] font-medium text-fg-3';
const group = 'overflow-hidden rounded-xl border border-line bg-white/[0.02] divide-y divide-line';
// 44px rows (a comfortable tap). The focus outline is drawn inside the row: the card clips anything outside.
const setting = 'flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-fg';
const settingButton = cn(setting, 'transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/60');
const trailing = 'ml-auto flex shrink-0 items-center gap-1 text-[12.5px] text-fg-3';
// (Before 2026-11-14: a switch that no longer fit beside its name went under it in the narrowest drawer.
// The Default agent row now always puts its switch on its own full-width line instead.)
// Destructive red (Radix's red 11 for dark surfaces): the one colour in the rail, kept for actions
// that cannot be undone. Since 2026-11-14 it is the text of a row in Your data, not a filled red button.
const danger = 'text-[#ff6369]';

// The logo and the word, sized to each other: the mark's ink (22px box, 10% inset) is 1.3x the
// wordmark's cap height, so neither one outweighs the other. Same lockup on the intro screen.
export function Lockup() {
  return (
    <>
      <RelatchMark still size={22} className="text-fg" />
      <span className="text-[19px] font-semibold leading-none tracking-[-0.025em]">Relatch</span>
    </>
  );
}

// The signed-in person's picture, or their initial while Clerk has none.
function Avatar() {
  const { user } = useUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || '';
  return user?.imageUrl
    ? <img src={user.imageUrl} alt="" className="size-7 shrink-0 rounded-full object-cover" />
    : <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.1] text-[12px] font-medium text-fg">{(name[0] || '?').toUpperCase()}</span>;
}

// Clearing the history cannot be undone, so it asks first. Cancel has the focus: Enter on a reflex
// keeps the skills.
function ClearDialog({ count, onCancel, onProceed }: { count: number; onCancel: () => void; onProceed: () => void }) {
  return (
    <Modal label="Clear skill history" role="alertdialog" onClose={onCancel} className="max-w-[360px] rounded-[20px] border border-line-2 bg-ink-1 px-6 pb-5 pt-6 shadow-[0_40px_120px_rgb(0_0_0/0.7)]">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Clear skill history?</h2>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-fg-2">
        This permanently deletes {count === 1 ? 'the skill' : `all ${count} skills`} saved to your account. You can't undo this.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button autoFocus onClick={onCancel} className={cn('h-9 rounded-full border border-line-2 px-4 text-[13.5px] text-fg transition-colors hover:bg-white/[0.06]', ring)}>Cancel</button>
        <button onClick={onProceed} className={cn('h-9 rounded-full bg-[#e5484d] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#ec5d5e] active:scale-[0.98]', ring)}>Proceed</button>
      </div>
    </Modal>
  );
}

// What the plan allows and how much of today is left. Signed in: the free plan's 3 a day (5 until 2026-11-14), counted by the
// server (usePlan), resetting at 00:00 UTC shown on this person's clock. Signed out: the one free try.
function PlanCard({ signedIn }: { signedIn: boolean }) {
  const plan = usePlan();
  let tried = false;
  try { tried = !!localStorage.getItem(ANON_TRIAL_USED_KEY); } catch { /* storage blocked */ }
  const used = signedIn ? plan?.used ?? null : tried ? 1 : 0;
  const limit = signedIn ? plan?.limit ?? 3 : 1; // fallback = backend DAY_LIMIT (3 since 2026-11-14, was 5)
  const left = used == null ? null : Math.max(0, limit - used);
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13.5px] font-medium text-fg">{signedIn ? 'Free' : 'Free try'}</p>
        {/* No number until the server has given one: never a guess. */}
        <p className="text-[12.5px] tabular-nums text-fg-2">
          {signedIn ? (left == null ? `${limit} skills a day` : left === 0 ? 'None left today' : `${left} of ${limit} left today`) : tried ? 'Used' : '1 skill'}
        </p>
      </div>
      {used != null && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.08]" role="meter" aria-label={signedIn ? 'Skills used today' : 'Free try'} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
          <div className="h-full rounded-full bg-fg transition-[width] duration-700 ease-out-expo" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
        </div>
      )}
      <p className="mt-2 text-[12px] leading-snug text-fg-3">{signedIn ? `Resets at ${resetTime()}` : 'A free account gives you 3 skills a day.'}</p>
    </div>
  );
}

// Pausing is a real choice, so it asks first and says plainly what is lost. "Keep history" has the focus.
function PauseDialog({ onCancel, onPause }: { onCancel: () => void; onPause: () => void }) {
  return (
    <Modal label="Pause skill history" role="alertdialog" onClose={onCancel} className="max-w-[380px] rounded-[20px] border border-line-2 bg-ink-1 px-6 pb-5 pt-6 shadow-[0_40px_120px_rgb(0_0_0/0.7)]">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Pause skill history?</h2>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-fg-2">
        While it's paused, new skills aren't kept: they won't appear in your sidebar, and once you leave the page you can't open or download them again. Skills already saved stay until you clear them.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onPause} className={cn('h-9 rounded-full border border-line-2 px-4 text-[13.5px] text-fg transition-colors hover:bg-white/[0.06]', ring)}>Pause</button>
        <button autoFocus onClick={onCancel} className={cn('h-9 rounded-full bg-white px-4 text-[13.5px] font-medium text-black transition-colors hover:bg-white/90 active:scale-[0.98]', ring)}>Keep history</button>
      </div>
    </Modal>
  );
}

// Settings > Your data > Skill history: what is kept and why, every skill as one download, and, last and
// quietest, pausing it. Two steps in and behind a confirmation on purpose: a switch on the first screen
// gets flipped by reflex, and a person who pauses loses the way back to everything they make after.
// It is never hidden either: it is the person's own data, and a control nobody can find is a dark pattern.
function HistoryPanel({ skills, paused, onPaused, onBack }: { skills: SavedSkill[]; paused: boolean; onPaused: (p: boolean) => void; onBack: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!box.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    box.current.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'translateX(0px)' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, []);
  const exportAll = async () => {
    setBusy(true);
    try { await downloadAll(skills.map((s) => ({ target: s.target, name: s.name, parts: (s.files ?? [{ name: s.name, content: s.content }]).map((f) => ({ name: f.name, content: f.content })) }))); } finally { setBusy(false); }
  };
  return (
    <div ref={box} role="region" aria-labelledby="history-h" className="absolute inset-0 z-20 flex flex-col bg-ink" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex h-16 shrink-0 items-center gap-1.5 px-3">
        <button onClick={onBack} aria-label="Back to settings" className={iconButton}><ArrowLeftIcon size={17} /></button>
        <h2 id="history-h" className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Skill history</h2>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-2">
        <p className="text-[13.5px] leading-[1.55] text-fg-2">Relatch keeps the skill files you make, so you can reopen them and download them again from the sidebar. The documents you upload are never kept.</p>
        <p className="mt-4 text-[12.5px] text-fg-3">{skills.length === 1 ? '1 skill saved' : `${skills.length} skills saved`}</p>
        <button disabled={!skills.length || busy} onClick={exportAll} className={cn('mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line-2 text-[13.5px] text-fg transition-colors hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-40', ring)}>
          <DownloadSimpleIcon size={15} />{busy ? 'Preparing…' : 'Download all skills'}
        </button>
        <div className="mt-auto pt-8">
          {paused ? (
            <div className="rounded-xl border border-line bg-white/[0.02] p-3">
              <p className="text-[13px] leading-snug text-fg-2">Skill history is paused. New skills aren't kept until you resume it.</p>
              <button onClick={() => onPaused(false)} className={cn('mt-3 h-9 w-full rounded-full bg-white text-[13.5px] font-medium text-black transition-colors hover:bg-white/90', ring)}>Resume skill history</button>
            </div>
          ) : (
            <button onClick={() => setAsking(true)} className={cn('rounded-md text-[12.5px] text-fg-3 underline decoration-white/15 underline-offset-4 transition-colors hover:text-fg-2', ring)}>Pause skill history</button>
          )}
        </div>
      </div>
      {asking && <PauseDialog onCancel={() => setAsking(false)} onPause={() => { onPaused(true); setAsking(false); }} />}
    </div>
  );
}

// Settings take over the whole rail (same width, same height) instead of floating over a corner of it.
// The everyday choices are at the top; the account sits at the bottom, where it is in the rail itself,
// with the one irreversible action just above it, set apart by a rule. (2026-11-14: clearing the history
// moved into Your data as that card's last row; only the account is left at the bottom.)
// Every control does something: today's skills left on the plan, who new skills are written for, whether
// the background moves, the skill history (download it all, or pause it), the API page (removed 2026-11-03), wiping the skills
// kept in the account (and this browser's copy of them), and the account's own settings.
function SettingsPanel({ target, onTarget, motion, onMotion, skills, signedIn, paused, onPaused, onClear, onBack, onAuth, onAccount, onSoon }: { target: Target; onTarget: (t: Target) => void; motion: boolean; onMotion: (on: boolean) => void; skills: SavedSkill[]; signedIn: boolean; paused: boolean; onPaused: (p: boolean) => void; onClear: () => void; onBack: () => void; onAuth: (view: 'sign-in' | 'sign-up') => void; onAccount: () => void; onSoon: () => void }) {
  const count = skills.length;
  const [confirm, setConfirm] = useState(false);
  // The Skill history page, opened from Your data. Read through a ref by the dismiss handler below,
  // which is set up once: Escape there goes back one level, to Settings.
  const [history, setHistoryOpen] = useState(false);
  const historyOpen = useRef(false);
  const showHistory = (on: boolean) => { historyOpen.current = on; setHistoryOpen(on); };
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, true, () => (historyOpen.current ? showHistory(false) : onBack())); // a press outside the rail, or Escape, goes back

  useLayoutEffect(() => {
    if (!box.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    box.current.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'translateX(0px)' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, []);

  return (
    <div ref={box} id="settings-panel" role="region" aria-labelledby="settings-h" className="absolute inset-0 z-10 flex flex-col bg-ink" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex h-16 shrink-0 items-center gap-1.5 px-3">
        <button onClick={onBack} aria-label="Back to your skills" className={iconButton}><ArrowLeftIcon size={17} /></button>
        <h2 id="settings-h" className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Settings</h2>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-1">
        <section aria-labelledby="set-plan">
          <h3 id="set-plan" className={heading}>Plan</h3>
          <PlanCard signedIn={signedIn} />
        </section>

        <section aria-labelledby="set-prefs">
          <h3 id="set-prefs" className={heading}>Preferences</h3>
          <div className={group}>
            {/* The switch gets its own full-width line under the name, its three parts equal: the rail is
                272px at most, too narrow to hold both on one line. Sized from out here, so the shared
                Segmented / SlidingThumb code stays untouched (the thumb measures the buttons it lands on).
                Icon: left-right arrows (switching between agents), Manas's pick from a 9-icon sheet on 2026-11-14;
                the robot that came first was rejected. */}
            <div className="px-3 pb-3 pt-2.5">
              <div className="flex min-h-6 items-center gap-2.5 text-[13.5px] text-fg"><ArrowsLeftRightIcon size={16} className="shrink-0 text-fg-2" />Default agent</div>
              <div className="mt-2.5 [&>[role=radiogroup]]:flex [&>[role=radiogroup]]:w-full [&_[role=radio]]:h-7 [&_[role=radio]]:flex-1 [&_[role=radio]]:px-1">
                <Segmented label="Default agent" value={target} onChange={onTarget} options={[['claude', 'Claude'], ['codex', 'Codex'], ['agents', 'Agents']] as const} />
              </div>
            </div>
            <div className={setting}>
              <WavesIcon size={16} className="shrink-0 text-fg-2" />
              <span className="min-w-0 flex-1 leading-snug">Background motion</span>
              <button role="switch" aria-checked={motion} aria-label="Background motion" onClick={() => onMotion(!motion)} className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200', ring, motion ? 'bg-white' : 'bg-white/15')}>
                <span className={cn('absolute left-0.5 top-0.5 size-4 rounded-full transition-transform duration-200', motion ? 'translate-x-4 bg-black' : 'bg-white/70')} />
              </button>
            </div>
          </div>
        </section>

        {signedIn && (
          <section aria-labelledby="set-data">
            <h3 id="set-data" className={heading}>Your data</h3>
            <div className={group}>
              <button onClick={() => showHistory(true)} className={settingButton}>
                <ClockCounterClockwiseIcon size={16} className="shrink-0 text-fg-2" />
                <span className="min-w-0 flex-1 leading-snug">Skill history</span>
                <span className={trailing}>{paused ? 'Paused' : 'On'}<CaretRightIcon size={13} /></span>
              </button>
              {/* Was a filled red button above the account (until 2026-11-14). Now the last row of the data it
                  wipes, red text only, still behind the confirmation. Without an account there is no history
                  to clear, so it lives inside this signed-in-only section. */}
              <button disabled={count === 0} onClick={() => setConfirm(true)} className={cn(settingButton, danger, 'hover:bg-[#e5484d]/[0.08] disabled:pointer-events-none disabled:opacity-40')}>
                <TrashIcon size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 leading-snug">Clear skill history</span>
              </button>
            </div>
          </section>
        )}

        {/* 2026-11-03: in place of the API platform (removed), a look at what is next. */}
        <section aria-labelledby="set-soon">
          <h3 id="set-soon" className={heading}>Coming soon</h3>
          <div className={group}>
            <button onClick={onSoon} className={settingButton}>
              {/* The Relatch mark, not a sparkle (Manas, 2026-11-10: the stock sparkle read as AI slop): the row
                  is Relatch going into your agent, and the page it opens is this mark with the agents round it.
                  aria-hidden: the mark's own label would read "Relatch Relatch in your agent".
                  2026-11-14 (Manas): the mark looked out of place beside the line icons of the other rows, and
                  the sparkle stays out. Now Phosphor's link (Manas's pick from a 12-icon sheet; the puzzle piece came first and
                  was rejected), same weight as its neighbours: the
                  feature is Relatch as a connector / plugin inside Claude and Codex. */}
              <LinkSimpleIcon size={16} className="shrink-0 text-fg-2" />
              <span className="min-w-0 flex-1 leading-snug">Relatch in your agent</span>
              <span className={trailing}><span className="rounded-full border border-line px-2 py-px text-[11px] leading-[18px]">Soon</span><CaretRightIcon size={13} /></span>
            </button>
          </div>
        </section>
      </div>

      {/* The account sits at the bottom, where it is in the rail itself, under a rule. */}
      <div className="shrink-0 border-t border-line p-3">
        <Show when="signed-in">
          <button onClick={onAccount} className={cn('group/acct flex h-10 w-full items-center gap-2.5 rounded-lg px-1.5 text-left transition-colors hover:bg-white/[0.04]', ring)}>
            <Avatar />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg-2 transition-colors group-hover/acct:text-fg">Your account</span>
            <ArrowUpRightIcon size={15} className="mr-1 shrink-0 text-fg-3 transition-colors group-hover/acct:text-fg" />
          </button>
        </Show>
        <Show when="signed-out">
          <div className="flex items-center gap-2">
            <button onClick={() => onAuth('sign-up')} className="h-9 flex-1 rounded-full bg-white text-[13.5px] font-medium text-black transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70">Sign up</button>
            <button onClick={() => onAuth('sign-in')} className={cn('h-9 flex-1 rounded-full border border-line-2 text-[13.5px] text-fg transition-colors hover:bg-white/[0.06]', ring)}>Sign in</button>
          </div>
        </Show>
      </div>

      {confirm && <ClearDialog count={count} onCancel={() => setConfirm(false)} onProceed={() => { onClear(); setConfirm(false); }} />}
      {history && <HistoryPanel skills={skills} paused={paused} onPaused={onPaused} onBack={() => showHistory(false)} />}
    </div>
  );
}

const wide = () => window.matchMedia('(min-width: 1024px)').matches;
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Sidebar({ skills, activeId, building, buildingActive, open, collapsed, target, motion, paused, onPaused, onClose, onHome, onNew, onOpen, onLive, onRemove, onClear, onInstall, onTarget, onMotion, onAuth, onAccount, onSoon }: {
  skills: SavedSkill[];
  activeId: string | null;
  building: boolean;
  buildingActive: boolean;
  open: boolean;       // the drawer, under 1024px
  collapsed: boolean;  // closed, on a wide screen
  target: Target;
  motion: boolean;
  paused: boolean;     // skill history paused: new skills are not kept
  onPaused: (p: boolean) => void;
  onClose: () => void;
  onHome: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onLive: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onInstall: () => void;
  onTarget: (t: Target) => void;
  onMotion: (on: boolean) => void;
  onAuth: (view: 'sign-in' | 'sign-up') => void;
  onAccount: () => void;
  onSoon: () => void;
}) {
  const { isSignedIn } = useUser();
  const signedIn = !!isSignedIn;
  const [filter, setFilter] = useState<Filter>('all');
  const [settings, setSettings] = useState(false);
  const shown = filter === 'all' ? skills : skills.filter((s) => s.target === filter);

  // On a wide screen the rail arrives by sliding its own width in from the left edge: when the first
  // skill starts building, and whenever it is reopened. Its margin, not a transform, does the moving, so
  // the main pane is pushed across in step and whatever is on the page glides right with the rail,
  // the one direction everything travels, instead of jumping once the rail is in place.
  const rail = useRef<HTMLElement>(null);
  const leaving = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    leaving.current?.cancel();
    leaving.current = null;
    const el = rail.current;
    if (collapsed || !el || !wide() || calm()) return;
    el.animate([{ marginLeft: `-${el.offsetWidth}px` }, { marginLeft: '0px' }], { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, [collapsed]);
  // Closing plays the same slide back, faster, before the rail leaves the layout. Under 1024px the
  // drawer has its own transition.
  const close = () => {
    const el = rail.current;
    if (!el || !wide() || calm()) { onClose(); return; }
    leaving.current = el.animate([{ marginLeft: '0px' }, { marginLeft: `-${el.offsetWidth}px` }], { duration: 300, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' });
    leaving.current.onfinish = onClose;
  };

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className={cn('fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <aside
        ref={rail}
        aria-label={signedIn ? 'Your skills' : 'Sidebar'}
        className={cn(
          // lg:left-auto: sticky with the drawer's left:0 would pin the rail to the screen edge and cancel
          // its slide-in margin.
          // As a drawer it always leaves 56px of the page showing to tap away on, which only narrows it
          // under 328px (a Galaxy Fold's cover screen); docked it is always 272px.
          'fixed inset-y-0 left-0 z-50 flex w-[min(272px,calc(100vw-56px))] shrink-0 flex-col border-r border-line bg-ink/80 backdrop-blur-xl transition-transform duration-500 ease-out-expo lg:sticky lg:left-auto lg:top-0 lg:z-30 lg:h-dvh lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'lg:hidden',
        )}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between pl-5 pr-3">
          {/* The logo goes to the home screen. "New skill" below is the way to the drop zone. The mark's
              ink starts 10% inside its own box (2.1px at 22px): pulled back so the ink sits on the edge. */}
          <button onClick={onHome} className={cn('-ml-[2.1px] flex items-center gap-2 rounded-lg', ring)} aria-label="Relatch home">
            <Lockup />
          </button>
          <button onClick={close} aria-label="Close sidebar" className={iconButton}><SidebarSimpleIcon size={18} /></button>
        </div>

        <div className="shrink-0 space-y-1 px-3">
          <button onClick={onNew} className={cn('flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-white/[0.04] px-3 text-[14px] font-medium text-fg transition-colors hover:border-line-2 hover:bg-white/[0.07]', ring)}>
            <PlusIcon size={15} weight="bold" />New skill
          </button>
          <button onClick={onInstall} className={cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[13.5px] text-fg-2 transition-colors hover:bg-white/[0.04] hover:text-fg', ring)}>
            <PlayCircleIcon size={16} />How to install
          </button>
        </div>

        {signedIn ? (<>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2 pl-5 pr-3 pt-6">
          <p className="whitespace-nowrap text-[12.5px] font-medium text-fg-3">Your skills</p>
          <Segmented label="Show skills for" value={filter} onChange={setFilter} options={[['all', 'All'], ['claude', 'Claude'], ['codex', 'Codex'], ['agents', 'Agents']] as const} />
        </div>
        <nav aria-label="Skills you have made" className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          {/* Paused stays visible where it matters, with the way back one click away. */}
          {paused && (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-[12.5px] text-fg-3">
              <span>History is paused</span>
              <button onClick={() => onPaused(false)} className={cn('rounded-md px-1 text-fg-2 transition-colors hover:text-fg', ring)}>Resume</button>
            </div>
          )}
          {building && (
            <button onClick={onLive} aria-current={buildingActive ? 'true' : undefined} className={cn(row(buildingActive), 'w-full gap-2.5 px-2.5 text-left text-[13.5px]', ring)}>
              <RelatchMark state="thinking" glow={false} size={15} className="text-fg" />
              <span className="truncate">Writing your skill</span>
            </button>
          )}
          {shown.map((s) => (
            <div key={s.id} className={row(s.id === activeId)}>
              <button onClick={() => onOpen(s.id)} aria-current={s.id === activeId ? 'true' : undefined} className={cn('flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-2.5 pr-1 text-left text-[13.5px]', ring)}>
                <TargetLogo target={s.target} size={14} />
                <span className="truncate">{s.name}</span>
              </button>
              {/* The age gives way to the remove button on hover or keyboard focus. */}
              <span className="relative mr-1.5 grid h-6 w-7 shrink-0 place-items-center">
                <span className="text-[12px] text-fg-3 transition-opacity group-focus-within/row:opacity-0 group-hover/row:opacity-0">{ago(s.createdAt)}</span>
                <button onClick={() => onRemove(s.id)} aria-label={`Remove ${s.name}`} className={cn('pointer-events-none absolute inset-0 grid place-items-center rounded-md text-fg-3 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-fg focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100', ring)}>
                  <XIcon size={13} />
                </button>
              </span>
            </div>
          ))}
          {!building && skills.length === 0 && <p className="px-2.5 py-2 text-[13px] leading-snug text-fg-3">Skills you make will appear here.</p>}
          {skills.length > 0 && shown.length === 0 && <p className="px-2.5 py-2 text-[13px] leading-snug text-fg-3">No {filter === 'all' ? '' : TARGET_NAME[filter]} skills yet.</p>}
        </nav>
        </>) : (
          // The free try is not kept: say so where the list would be, so nobody looks for it later.
          <div className="min-h-0 flex-1 px-5 pt-6">
            <p className="text-[13px] leading-[1.55] text-fg-3">Skills you make are kept here once you have an account. The free try isn't saved, so download it before you leave.</p>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
          <Show when="signed-out">
            <button onClick={() => onAuth('sign-up')} className="h-9 flex-1 rounded-full bg-white text-[13.5px] font-medium text-black transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70">Sign up</button>
            <button onClick={() => onAuth('sign-in')} className={cn('h-9 flex-1 rounded-full border border-line-2 text-[13.5px] text-fg transition-colors hover:bg-white/[0.06]', ring)}>Sign in</button>
          </Show>
          <Show when="signed-in">
            {/* The picture keeps Clerk's own menu (sign out); the words open the account settings. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
              <UserButton />
              <button onClick={onAccount} className={cn('min-w-0 truncate rounded-md px-1 py-0.5 text-left text-[13.5px] text-fg-2 transition-colors hover:text-fg', ring)}>Your account</button>
            </div>
          </Show>
          <button type="button" aria-label="Settings" aria-expanded={settings} aria-controls="settings-panel" onClick={() => setSettings(true)} className={cn(iconButton, 'rounded-full border border-line hover:border-line-2')}>
            <GearSixIcon size={17} />
          </button>
        </div>

        {settings && <SettingsPanel target={target} onTarget={onTarget} motion={motion} onMotion={onMotion} skills={skills} signedIn={signedIn} paused={paused} onPaused={onPaused} onClear={onClear} onBack={() => setSettings(false)} onAuth={onAuth} onAccount={onAccount} onSoon={() => { setSettings(false); onSoon(); }} />}
      </aside>
    </>
  );
}
