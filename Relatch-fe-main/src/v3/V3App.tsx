// Relatch V3: one page that changes state instead of a five-step wizard.
//   Start -> one card that thinks, then becomes the skill preview + setup walkthrough
//
// Two screens, on purpose:
//   Intro      nobody has made a skill here yet. The headline, the switch and the drop zone, with nothing
//              above or below them but a logo and the account buttons.
//   Workspace  from the moment the first skill starts building. A left rail lists the skills made here
//              and the main pane holds the one being written, a saved one, or the "new skill" drop zone.
import { useEffect, useRef, useState } from 'react';
import { Show, UserButton, useUser } from '@clerk/react';
import { ArrowClockwiseIcon, SidebarSimpleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { Start } from './Start';
import { JobStage, type Adding, type Lock, type Part, type Plan } from './JobStage';
import { readPendingClaim, setPendingAction } from './claim';
import { Lockup, Sidebar } from './Sidebar';
import { InstallDialog } from './InstallDialog';
import { AccountDialog } from './AccountDialog';
import { Modal } from './Modal';
import { ContactPage } from './ContactPage';
import { LegalPage } from './LegalPage';
import { NotFound, leaveStrayPath, strayPath } from './ErrorScreens';
import { captureEvent, registerProps } from '../analytics';
import { FeedbackNote, NOTE_READY, noteSeen } from './FeedbackNote';

// SANDBOX ONLY (compiled out of production): the sandbox bar's "Crash the app" leaves this flag and reloads;
// read once, so the crash screen's Reload brings the app back.
const SANDBOX_CRASH = (() => {
  if (!import.meta.env.VITE_SANDBOX) return false;
  try { const on = sessionStorage.getItem('sbx_crash') === '1'; sessionStorage.removeItem('sbx_crash'); return on; } catch { return false; }
})();
// The first-skill note's wait once the screen is clear: a moment after the install guide closes, or a while with the
// full skill after a Read / Copy unlock, so it never covers the skill they just unlocked before they've read it.
const NOTE_AFTER_DOWNLOAD = 900;
const NOTE_AFTER_UNLOCK = 20_000;
// SANDBOX ONLY: the sandbox bar's "Show the feedback note" opens the note on the next load, once
const SANDBOX_NOTE = (() => {
  if (!import.meta.env.VITE_SANDBOX) return false;
  try { const on = !!sessionStorage.getItem('sbx_note'); sessionStorage.removeItem('sbx_note'); return on; } catch { return false; }
})();
import { ComingSoon } from './ComingSoon';
import { HelpMenu } from './HelpMenu';
import { Ambient } from './Ambient';
import { AuthSheet, type Unlock } from './auth/AuthSheet';
import { appPath, pathInApp } from './base';
import { RelatchMark } from './RelatchMark';
import { stripFrontmatter } from './SkillMarkdown';
import { useSkillJob, MAX_FILES, type ClaimError, type JobItem } from './useSkillJob';
import { useSkillHistory, type SavedSkill } from './useSkillHistory';
import { resetTime } from './usePlan';
import { useUnfold } from './useUnfold';
import { useIdentify } from './useIdentify';
import { SAMPLE_FILE_NAME, SAMPLE_FILE_CONTENT } from '@/engine/core';
import { cn } from '@/lib/utils';
import type { Target } from './skillExport';

const pill = 'inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14.5px] font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

// Where the person is, kept for this tab only (sessionStorage), so a reload puts them back there: the
// skill they had open, a page (Contact, Privacy, Terms; the API page until 2026-11-03), or the home screen. A skill still being written cannot survive a
// reload (its request lived in the page), so that place is remembered only to say what happened.
// 2026-11-03: the 'api' page (the API platform) is gone - Relatch is not building an API platform, and the
// MCP server that replaced it is a post-V3 idea (vault "Relatch MCP Server - Future Plan"). A place
// remembered as 'api' from before simply no longer matches, so a reload lands on the home screen.
// 'soon' (2026-11-03, Manas): in its place, Settings opens "Relatch in your agent - coming soon" (ComingSoon.tsx).
type Page = 'contact' | 'privacy' | 'terms' | 'soon';
const isPage = (v: string): v is Page => v === 'contact' || v === 'privacy' || v === 'terms' || v === 'soon';
const PAGE_TITLES: Record<Page, string> = { contact: 'Contact', privacy: 'Privacy policy', terms: 'Terms of service', soon: 'Relatch in your agent' };
// 2026-11-15 (flip): the legal pages' own addresses, so Clerk's sign-up consent can link straight to them.
// /legal is the Terms (they link to the Privacy Policy). Opening one shows that page; leaving it puts the address
// back to the app's own, so a reload doesn't reopen it.
const LEGAL_PATHS: Record<string, Page> = { '/privacy-policy': 'privacy', '/terms-of-service': 'terms', '/legal': 'terms' };
function legalPageAtUrl(): Page | null {
  const at = pathInApp(window.location.pathname);
  return at ? LEGAL_PATHS[at.length > 1 ? at.replace(/\/+$/, '') : at] ?? null : null;
}
type Place = { view: 'skill'; id: string } | { view: Page } | { view: 'home' } | { view: 'building' };
const PLACE = 'relatch_v3_place';
function readPlace(): Place | null {
  try { return JSON.parse(sessionStorage.getItem(PLACE) || 'null'); } catch { return null; }
}

const INTERRUPTED = 'The page reloaded while your skill was being written, so it stopped. Drop the document again to rebuild it.';
const tooMany = (used: number) => `A skill is built from up to ${MAX_FILES} documents, so only the first ${used} ${used === 1 ? 'was' : 'were'} used.`;

// A skill file's own name, from its frontmatter. Never the document's file name: that is not kept.
const skillName = (md: string) => stripFrontmatter(md).front.name || 'Untitled skill';

// A file Relatch cannot read. The drop zone names kinds of documents, never a format list (a list reads
// as "only these"), so the exact formats are given here, where they answer a real question.
const READS = 'Relatch reads PDFs (scanned ones too), Word documents, text and Markdown, HTML, CSV, JSON, YAML and code files.';
const unreadable = (message: string | null) => /^Unsupported file type/.exec(message ?? '') ? (message!.match(/(\.\w+)\s*$/)?.[1] ?? '') : null;
const cantRead = (ext: string) => `Relatch can't read ${ext ? `${ext} files` : 'this file'} yet.`;

// Why one document of a skill could not be written, in the switcher.
function itemNote(i: JobItem) {
  if (i.error === 'quota') return "Today's free skills are used up.";
  if (i.error === 'trial-used' || i.error === 'signup-needed') return 'Create a free account to add more documents.';
  if (i.error === 'check') return "The quick bot check didn't finish. Try again.";
  if (i.error === 'busy') return 'Too many free tries from this network.';
  const ext = unreadable(i.message);
  if (ext != null) return cantRead(ext);
  return i.message || "Couldn't be written.";
}

// The skill files of the job on screen, or of a skill reopened from the history.
const liveParts = (items: JobItem[]): Part[] => items.map((i) => ({ key: i.id, name: i.result ? skillName(i.result.content) : i.fileName.replace(/\.[^.]+$/, ''), content: i.result?.content ?? '', degraded: !!i.result?.degraded, status: i.status, note: i.status === 'error' ? itemNote(i) : null, fileName: i.fileName, steps: i.steps, seconds: i.result?.seconds, locked: !!i.result?.locked }));

// Why the free skill didn't unlock once they were in (useSkillJob's claim). Every one leaves it a preview.
const CLAIM_MESSAGES: Record<ClaimError, string> = {
  limit: "This account has already unlocked its free skill, so this one stays a preview. Make it again from your account: it's one of today's 3.",
  gone: "This free skill can't be unlocked any more (they're kept for 24 hours). Make it again from your account: it's one of today's 3.",
  taken: 'This free skill was unlocked by another account.',
  retry: "Couldn't unlock your skill just now. Try again in a moment.",
  failed: "Couldn't unlock your skill. Make it again from your account: it's one of today's 3.",
  // Ends with the reset time on this person's clock (runClaim). Wording picked by Manas 2026-11-19 (reassurance first).
  quota: "Today's free skills are all used. Your skill is safe for 24 hours: keep this tab open and unlock it after",
};
const savedParts = (s: SavedSkill): Part[] => (s.files ?? [{ name: s.name, content: s.content, degraded: s.degraded }]).map((f, n) => ({ key: `${s.id}_${n}`, name: f.name, content: f.content, degraded: f.degraded, status: 'done' as const }));
const FINISHED: Adding = { canAdd: false, left: 0, closed: 'This skill is finished. Start a new skill to build from more documents.', onAdd: () => {}, complete: () => {} };

// Asked before a new skill replaces one that is still being written. The one in progress cannot be
// called back: its request goes to the server either way, so it still counts toward today's five, or
// spends the free try. "Keep writing" has the focus, so Enter on a reflex keeps it.
function StopDialog({ signedIn, onKeep, onStop }: { signedIn: boolean; onKeep: () => void; onStop: () => void }) {
  return (
    <Modal label="Stop writing this skill" role="alertdialog" onClose={onKeep} className="max-w-[380px] rounded-[20px] border border-line-2 bg-ink-1 px-6 pb-5 pt-6 shadow-[0_40px_120px_rgb(0_0_0/0.7)]">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Stop writing this skill?</h2>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-fg-2">
        {signedIn
          ? "Relatch is still writing it. If you start a new skill now, this one is thrown away, but it still counts toward today's 5."
          : "Relatch is still writing your free skill. If you start over now, it's thrown away and your free try is used up."}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onStop} className="h-9 rounded-full border border-line-2 px-4 text-[13.5px] text-fg transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-white/60">{signedIn ? 'Start new' : 'Start over'}</button>
        <button autoFocus onClick={onKeep} className="h-9 rounded-full bg-white px-4 text-[13.5px] font-medium text-black transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 active:scale-[0.98]">Keep writing</button>
      </div>
    </Modal>
  );
}

export default function V3App() {
  const { isSignedIn, user } = useUser();
  useIdentify(); // PostHog knows who a signed-in person is (production parity, 2026-11-15)
  // A foldable opened from its cover screen: the app opens out with it (useUnfold.ts).
  useUnfold();
  const [target, setTarget] = useState<Target>(() => {
    try { const t = localStorage.getItem('relatch_v3_target'); return t === 'codex' || t === 'agents' ? t : 'claude'; } catch { return 'claude'; }
  });
  // ?auth=sign-in / sign-up opens the sheet on arrival (2026-11-15: the SSO callback sends a sign-in that needs
  // another step back here). The parameter is removed at once so a reload or a shared link doesn't reopen it.
  const [auth, setAuth] = useState<'sign-in' | 'sign-up' | null>(() => {
    try {
      const url = new URL(window.location.href);
      const asked = url.searchParams.get('auth');
      if (asked !== 'sign-in' && asked !== 'sign-up') return null;
      url.searchParams.delete('auth');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      return asked;
    } catch { return null; }
  });
  // The unlock sheet: the free skill's Copy / Download / read-it-all, signed out. `resume` is that action, handed
  // back to the preview once they're in (2026-11-15 hybrid plan)
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [resume, setResume] = useState<Unlock['action'] | null>(null);
  // The download that follows an unlock sign-up still earns the first-skill note (with their account's email)
  const fromUnlock = useRef(false);
  // The action is also kept with the claim waiting in this tab (claim.ts), for a Google or GitHub sign-up
  const openSignUp = (u?: Unlock) => { if (u) { setUnlock(u); setPendingAction(u.action); } else setAuth('sign-up'); };
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const job = useSkillJob(target);
  const history = useSkillHistory();
  // The history belongs to an account. Someone without one (the free try) has no "Your skills": nothing
  // is kept for them, and nothing kept earlier in this browser is shown to them.
  const skills = isSignedIn ? history.skills : [];
  const [place] = useState(readPlace);
  // A saved skill opened from the rail. While it is set, the main pane shows it instead of the job. A
  // remembered id that is not in the visible history simply resolves to nothing (see `saved`).
  const [viewing, setViewing] = useState<string | null>(() => (place?.view === 'skill' ? place.id : null));
  // A page of its own, without the sidebar: the API platform (Settings > Developer actions; removed 2026-11-03), Contact
  // ("Contact us" on the home screen, "Contact support" in the help menu), or the Privacy policy and
  // Terms of service (the help menu).
  // The legal pages come from the address only (2026-11-19, launch test): restoring them from this tab's place too
  // meant app.relatch.online/ opened the Terms again after someone had read them, e.g. back to the landing page
  // and "Start for Free" landed on the Terms instead of the upload. Contact and 'soon' still come back on reload.
  const [page, setPage] = useState<Page | null>(() => legalPageAtUrl() ?? (place && isPage(place.view) && place.view !== 'privacy' && place.view !== 'terms' ? place.view : null));
  useEffect(() => {
    if (page || !legalPageAtUrl()) return;
    window.history.replaceState(window.history.state, '', appPath() + window.location.search + window.location.hash);
  }, [page]);
  // 2026-11-19 (launch test): each page of its own has its own tab title (search results, bookmarks, history all
  // read "Relatch - Turn documents into AI skills" before). Same pattern as the 404's "Page not found · Relatch".
  useEffect(() => {
    if (!page) return;
    const before = document.title;
    document.title = `${PAGE_TITLES[page]} · Relatch`;
    return () => { document.title = before; };
  }, [page]);
  // Clerk's account settings, as a pop-up.
  const [account, setAccount] = useState(false);
  // A short line in the corner: the page was reloaded mid-build, or more documents were dropped than a
  // skill can take.
  const [notice, setNotice] = useState<string | null>(place?.view === 'building' ? INTERRUPTED : null);
  // The history id of the job on screen, once it has finished and been saved.
  const [liveId, setLiveId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  // The rail closed on a wide screen (its own close button); a small button in the pane's corner reopens it.
  const [collapsed, setCollapsed] = useState(false);
  // The logo was pressed: show the home screen, even though there are skills to go back to.
  const [atHome, setAtHome] = useState(place?.view === 'home');
  // An address the app doesn't have (ErrorScreens.tsx): the 404 shows until they head back into the app
  const [stray, setStray] = useState(strayPath);
  // The first-skill note (FeedbackNote.tsx): due once someone without an account downloads their free skill,
  // shown a moment after the install guide closes, and never twice in one browser
  const [noteDue, setNoteDue] = useState(SANDBOX_NOTE);
  const [noteOpen, setNoteOpen] = useState(false);
  const noteTarget = useRef<Target>(target); // the agent of the skill they downloaded, sent with the note
  const noteWait = useRef(NOTE_AFTER_DOWNLOAD); // how long the screen stays clear before the note comes in
  if (SANDBOX_CRASH) throw new Error('Sandbox: a crash on purpose (sandbox bar)');
  // Settings > Your data: skill history paused, so new skills are not kept (the way back is in the rail).
  const [paused, setPaused] = useState(() => { try { return localStorage.getItem('relatch_v3_history_paused') === '1'; } catch { return false; } });
  // Settings: whether the background moves (the pulse and the drifting light).
  const [motion, setMotion] = useState(() => { try { return localStorage.getItem('relatch_v3_motion') !== 'off'; } catch { return true; } });
  // The install pop-up, and which skill its steps are written for.
  // `plan` is what the download is (one .md or a ZIP), so the walkthrough unpacks the right file.
  const [install, setInstall] = useState<{ target: Target; name: string; parts?: Part[]; plan?: Plan } | null>(null);
  const lastDownload = useRef<{ of: string; name: string; plan: Plan } | null>(null);

  useEffect(() => { try { localStorage.setItem('relatch_v3_target', target); } catch { /* ignore */ } }, [target]);
  useEffect(() => { try { localStorage.setItem('relatch_v3_motion', motion ? 'on' : 'off'); } catch { /* ignore */ } }, [motion]);
  useEffect(() => { try { if (paused) localStorage.setItem('relatch_v3_history_paused', '1'); else localStorage.removeItem('relatch_v3_history_paused'); } catch { /* ignore */ } }, [paused]);
  // The free try's unlock, once they're signed in (2026-11-17). With ANON_PREVIEW_ONLY on, what's on screen is a
  // preview: its full skill is claimed first, and only then is the tapped action handed back (`resume`), so a
  // preview is never downloaded or copied as if it were the skill. With the flag off there is nothing to claim
  // and the action carries on at once, as before.
  const lockedKey = job.items.filter((i) => i.status === 'done' && i.result?.locked).map((i) => i.id).join(',');
  const [lock, setLock] = useState<Lock | null>(null);
  const claiming = useRef(false);
  const wantAction = useRef<Unlock['action'] | null>(null);
  const runClaim = async () => {
    if (claiming.current) return;
    claiming.current = true;
    const live = !!lockedKey;
    setLock({ state: 'claiming' });
    // Once unlocked it is this account's skill, kept in the history like any other (unless paused). Set before
    // the claim lands so the save can't miss it; the history never keeps a set while any of it is locked.
    ownJob.current = !paused;
    kept.current = '';
    const r = await job.claim();
    claiming.current = false;
    if (r.ok) {
      if (!live) { setViewing(null); setAtHome(false); setPage(null); setLiveId(null); }
      setLock(null);
      const a = r.action ?? wantAction.current;
      wantAction.current = null;
      if (a) setResume(a);
      // 2026-11-20: the first-skill note is due on the unlock itself. It used to wait for a download only, but with
      // ANON_PREVIEW_ONLY on nobody without an account can download, so anyone who unlocked to Read or Copy never
      // saw it (feedback_note_shown had never fired in production). A download unlock keeps its own path
      // (`downloaded`, after the install guide); Read and Copy get a while with the full skill first.
      if (a !== 'download' && NOTE_READY && !noteSeen()) { noteTarget.current = job.target; noteWait.current = NOTE_AFTER_UNLOCK; setNoteDue(true); }
      return;
    }
    wantAction.current = null;
    const message = r.error === 'quota' ? `${CLAIM_MESSAGES.quota} ${resetTime()}.` : CLAIM_MESSAGES[r.error];
    // quota: the skill is still held, so the same button unlocks it after the reset (before it, it only says this again)
    setLock({ state: 'failed', message, ...(r.error === 'retry' || r.error === 'quota' ? { retry: () => { void runClaim(); } } : {}) });
    // Nothing on screen to say it on (back from a Google or GitHub sign-up): the corner notice
    if (!live) setNotice(message);
  };
  useEffect(() => {
    if (!isSignedIn) return;
    setAuth(null);
    // In from the unlock sheet: close it; what they tapped waits for the unlock (or carries on if nothing is locked)
    if (unlock) { wantAction.current = unlock.action; setUnlock(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the sheet as it was at sign-in
  }, [isSignedIn]);
  useEffect(() => {
    if (!isSignedIn) return;
    // No preview on screen but one waiting in this tab: an empty start (back from Google or GitHub), or the "free
    // skill is used" screen they signed up from after a reload. Either way the set is brought back from the claim.
    if (lockedKey || ((job.phase === 'idle' || job.phase === 'error') && readPendingClaim())) { void runClaim(); return; }
    if (wantAction.current) { setResume(wantAction.current); wantAction.current = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per sign-in, per new preview, per empty or error start
  }, [isSignedIn, lockedKey, job.phase]);
  useEffect(() => { if (job.phase !== 'done') window.scrollTo({ top: 0, behavior: 'smooth' }); }, [job.phase]);

  // A finished skill goes into the history: the skill files only, never the documents behind them. A
  // document added to it later updates the same entry.
  // Only a skill started while signed in is kept. The free try is never stored, not even when the
  // person signs up straight after it with the skill still on screen. Nor is one started while the
  // history is paused.
  const kept = useRef('');
  const keptAt = useRef(0);
  const ownJob = useRef(false);
  useEffect(() => {
    if (job.phase !== 'done' || !ownJob.current) return;
    const done = job.items.filter((i) => i.status === 'done' && i.result);
    // A preview is not the skill: it is kept once it is unlocked (runClaim), never before
    if (done.some((i) => i.result!.locked)) return;
    const sig = done.map((i) => i.id).join(',');
    if (!done.length || kept.current === sig) return;
    kept.current = sig;
    const id = liveId ?? `s_${Date.now().toString(36)}`;
    if (!liveId) { setLiveId(id); keptAt.current = Date.now(); }
    const files = done.map((i) => ({ name: skillName(i.result!.content), content: i.result!.content, degraded: i.result!.degraded }));
    history.add({ id, name: files[0].name, target: job.target, createdAt: keptAt.current, content: files[0].content, seconds: Math.max(...done.map((i) => i.result!.seconds)), degraded: files.some((f) => f.degraded), files: files.length > 1 ? files : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.phase, job.items]);

  const saved = viewing ? skills.find((s) => s.id === viewing) ?? null : null;
  // There is something to come back to: a job, or skills made earlier.
  const hasWork = job.phase !== 'idle' || skills.length > 0;
  // A skill on screen in this visit, being written or finished (for someone without an account, the only
  // one there is: it is not kept).
  const liveSkill = job.phase === 'thinking' || job.phase === 'done';
  // 2026-11-03: a signed-in person can open "Your skills" from the home screen even with none saved yet
  // (Manas saw no way in: the button only showed once there was work). `browsing` is that visit.
  const [browsing, setBrowsing] = useState(false);
  const workspace = (hasWork || (browsing && !!isSignedIn)) && !atHome;
  // The API and Contact pages stand alone, without the sidebar (see the early return below).
  const showPage = page !== null;
  // A drop-zone screen is up: the home screen, or "New skill" in the workspace.
  const composing = !showPage && (atHome || (job.phase === 'idle' && !saved));
  // A finished skill is on screen: the live one once it is done, or a saved one.
  const previewing = !composing && !showPage && (!!saved || job.phase === 'done');
  const onScreen = showPage ? null : saved ?? (job.phase === 'done' ? skills.find((s) => s.id === liveId) ?? null : null);

  useEffect(() => {
    const now: Place | null = job.phase === 'thinking' ? { view: 'building' } : page ? { view: page } : atHome && hasWork ? { view: 'home' } : onScreen ? { view: 'skill', id: onScreen.id } : null;
    try { if (now) sessionStorage.setItem(PLACE, JSON.stringify(now)); else sessionStorage.removeItem(PLACE); } catch { /* storage blocked: a reload starts fresh */ }
  }, [job.phase, page, atHome, hasWork, onScreen?.id]);

  // 2026-11-19 (PostHog rebuild): which screen is up. The whole app lives at one address, so without this every
  // click, heatmap point and replay moment is just "/". app_screen and app_overlay ride on every later event
  // (autocaptured clicks and heatmap data included), and screen_viewed marks each change.
  // 2026-11-20 (found live): 'home' is the intro start screen, 'new_skill' the compact one inside the workspace, by
  // the same `workspace` test <Start> renders with. It tested atHome, which a first visit never sets, so every
  // first-time home screen was reported as 'new_skill'.
  const screen =stray ? 'not_found' : showPage ? `page_${page}` : job.phase === 'thinking' && !composing && !saved ? 'building'
    : previewing ? (saved ? 'saved_skill' : 'skill_preview') : composing ? (workspace ? 'new_skill' : 'home') : job.phase === 'error' ? 'job_error' : 'workspace';
  const overlay = auth ? `auth_${auth}` : unlock ? 'unlock_sheet' : install ? 'install_guide' : account ? 'account' : null;
  useEffect(() => {
    registerProps({ app_screen: screen, app_overlay: overlay, signed_in: !!isSignedIn });
  }, [screen, overlay, isSignedIn]);
  useEffect(() => { captureEvent('screen_viewed', { screen }); }, [screen]);
  // The agent switch (Claude / Codex / Agents). selected_target rides on every event; target_selected marks a
  // deliberate change, not the value restored on load.
  const firstTarget = useRef(true);
  useEffect(() => {
    registerProps({ selected_target: target });
    if (firstTarget.current) { firstTarget.current = false; return; }
    captureEvent('target_selected', { target, screen });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the screen at the moment of the change, not a trigger
  }, [target]);

  const start = (files: File[]) => {
    if (!files.length) return;
    const used = files.slice(0, MAX_FILES);
    setLastFiles(used); setViewing(null); setAtHome(false); setPage(null); setLiveId(null); kept.current = ''; ownJob.current = !!isSignedIn && !paused;
    setNotice(files.length > MAX_FILES ? tooMany(MAX_FILES) : null);
    job.run(used);
  };
  // More documents for the skill on screen (see useSkillJob for why this is still the same skill).
  const addFiles = (files: File[]) => {
    if (!job.canAdd) return;
    setNotice(files.length > job.left ? tooMany(job.items.length + job.left) : null);
    job.add(files);
  };
  const sample = () => start([new File([SAMPLE_FILE_CONTENT], SAMPLE_FILE_NAME, { type: 'text/plain' })]);
  // Anything that would replace a skill still being written asks first (StopDialog): "New skill", "Make
  // another skill", and a document dropped on the home screen reached by the logo mid-build.
  const busy = job.items.some((i) => i.status === 'thinking');
  const [stopAsk, setStopAsk] = useState<(() => void) | null>(null);
  const guard = (go: () => void) => { if (busy) setStopAsk(() => go); else go(); };
  // "New skill": a fresh drop zone in the workspace.
  const home = () => { job.reset(); setViewing(null); setAtHome(false); setPage(null); setNotice(null); setRailOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  // The logo: the home screen. Nothing is reset, so a skill that is still being written keeps going.
  const goHome = () => { if (hasWork) setAtHome(true); else setBrowsing(false); setPage(null); setRailOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  // Back from the API or Contact page returns to wherever the person was: the skill, "New skill" or home,
  // all still as they left it, since opening the page changes none of that. Arrived any other way (a
  // reload on the page), there is nowhere to return to, so it goes to the home screen.
  const pageFrom = useRef(false);
  // From one page to another (Privacy to Terms, either to Contact), Back still returns to where the person
  // was before the first one: pageFrom is left as that first page set it.
  const openPage = (p: Page) => { if (!page) pageFrom.current = true; setPage(p); setRailOpen(false); window.scrollTo({ top: 0 }); };
  const leavePage = () => { if (!pageFrom.current) { setViewing(null); setAtHome(true); } pageFrom.current = false; setPage(null); window.scrollTo({ top: 0 }); };
  // Manas, 2026-11-10: a signed-out visitor never reads "your skill" (the free try is not theirs to keep), so
  // from their skill the button says just "Back". It still returns them to that skill.
  const pageBack = !pageFrom.current || atHome || !workspace ? 'Back to home' : saved || liveSkill ? (isSignedIn ? 'Back to your skill' : 'Back') : 'Back to New skill';
  // One pair of buttons, two different things: on a wide screen they close and reopen the column, under
  // 1024px they slide the drawer. Kept apart so a window that is resized does not inherit the other's state.
  const wide = () => window.matchMedia('(min-width: 1024px)').matches;
  const openRail = () => (wide() ? setCollapsed(false) : setRailOpen(true));
  const closeRail = () => (wide() ? setCollapsed(true) : setRailOpen(false));
  const openSaved = (id: string) => { setRailOpen(false); setPage(null); setNotice(null); setViewing(id === liveId && job.phase === 'done' ? null : id); window.scrollTo({ top: 0 }); };
  const openLive = () => { setRailOpen(false); setPage(null); setViewing(null); window.scrollTo({ top: 0 }); };
  // From the rail the guide opens for the skill on screen, or for whichever agent is selected.
  // "How to install" from the sidebar names the skill on screen, by the exact file its last download saved
  // (the name can be edited in the preview, and the free try is never kept, so neither is in history).
  const liveKey = `live:${job.items[0]?.id ?? ''}`;
  const openInstall = () => {
    setRailOpen(false);
    const live = !showPage && !saved && job.phase === 'done';
    const of = saved ? saved.id : live ? liveKey : null;
    const dl = of && lastDownload.current?.of === of ? lastDownload.current : null;
    if (saved) setInstall({ target: saved.target, name: dl?.name ?? saved.name, plan: dl?.plan, parts: savedParts(saved) });
    else if (live) setInstall({ target: job.target, name: dl?.name ?? liveParts(job.items).find((p) => p.status === 'done')?.name ?? '', plan: dl?.plan, parts: liveParts(job.items) });
    else setInstall({ target, name: '' });
  };
  const downloaded = (of: string, t: Target, name: string, plan: Plan, parts: Part[]) => {
    lastDownload.current = { of, name, plan };
    setInstall({ target: t, name, plan, parts });
    noteTarget.current = t;
    // Already due from a Read / Copy unlock: a download now brings it in after the guide, not after the long wait
    if (noteDue || ((!isSignedIn || fromUnlock.current) && NOTE_READY && !noteSeen())) { noteWait.current = NOTE_AFTER_DOWNLOAD; setNoteDue(true); }
    fromUnlock.current = false;
  };
  // Never over another pop-up or page: it waits until the install guide, the sign-up sheet, the account
  // settings (2026-11-20: likely inside the 20s after a Read / Copy unlock) and the 404 are gone
  useEffect(() => {
    if (!noteDue || install || auth || account || stray || showPage) return;
    const timer = window.setTimeout(() => { setNoteDue(false); setNoteOpen(true); }, noteWait.current);
    return () => window.clearTimeout(timer);
  }, [noteDue, install, auth, account, stray, showPage]);

  if (stray) {
    // Back into the app at its own address; it opens wherever they were, as any visit does
    const back = () => { leaveStrayPath(); setStray(null); window.scrollTo({ top: 0 }); };
    return <NotFound path={stray} onHome={back} onContact={() => { back(); openPage('contact'); }} />;
  }

  if (showPage) {
    return (
      <div className="min-h-dvh bg-ink text-fg">
        <Ambient dots={false} still={!motion} />
        {page === 'contact' ? <ContactPage onBack={leavePage} backLabel={pageBack} />
          : page === 'soon' ? <ComingSoon onBack={leavePage} backLabel={pageBack} />
          : <LegalPage doc={page} onBack={leavePage} backLabel={pageBack} onOpen={openPage} />}
        <HelpMenu onOpen={openPage} />
        {auth && <AuthSheet view={auth} onClose={() => setAuth(null)} />}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-ink text-fg">
      <Ambient live={composing && motion} dots={!previewing} still={!motion} />

      {workspace && (
        <Sidebar
          skills={skills}
          activeId={showPage ? null : saved ? saved.id : job.phase === 'done' ? liveId : null}
          building={job.phase === 'thinking'}
          buildingActive={job.phase === 'thinking' && !saved}
          open={railOpen}
          collapsed={collapsed}
          target={target}
          motion={motion}
          paused={paused}
          onPaused={setPaused}
          onClose={closeRail}
          onHome={goHome}
          onNew={() => guard(home)}
          onOpen={openSaved}
          onLive={openLive}
          onRemove={history.remove}
          onClear={() => { history.clear(); setViewing(null); }}
          onInstall={openInstall}
          onTarget={setTarget}
          onMotion={setMotion}
          onAuth={setAuth}
          onAccount={() => setAccount(true)}
          onSoon={() => openPage('soon')}
        />
      )}

      <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
        {workspace ? (
          // Under 1024px the rail is a drawer, so the workspace keeps a slim row to open it from. On a wide
          // screen the same two controls show only while the rail is closed, and without the bar behind them.
          // The sidebar button has the left corner to itself, so it is the first thing the eye finds. The
          // logo is the mark alone, in the opposite corner: no wordmark on the skill-building screens.
          // On a wide screen the row floats over the pane's corners instead of pushing the page down, so
          // closing the rail does not open a band of empty space above the skill.
          <div className={cn('chrome-x sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-line bg-ink/70 backdrop-blur-xl', collapsed ? 'lg:absolute lg:inset-x-0 lg:border-0 lg:bg-transparent lg:backdrop-blur-none' : 'lg:hidden')} style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <button onClick={openRail} aria-label="Open sidebar" className="-ml-2 grid size-9 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"><SidebarSimpleIcon size={19} /></button>
            {/* 8px of padding for a thumb, pulled back with the mark's own 2.2px inset so its ink sits on the gutter. */}
            <button onClick={goHome} className="-mr-[calc(0.5rem+2.2px)] rounded-lg p-2 focus-visible:outline-2 focus-visible:outline-white/60" aria-label="Relatch home">
              <RelatchMark still size={22} className="text-fg" />
            </button>
          </div>
        ) : (
          // The intro has no bar: the logo and the account buttons sit in the page's own corners.
          <header className="relative z-30 shrink-0" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="chrome-x flex h-16 items-center justify-between">
              {/* The mark's ink starts 10% inside its own box (2.1px at this size): pulled back so what the eye
                  sees, not the box, sits on the gutter. Same lockup as the sidebar's. */}
              <button onClick={goHome} className="-ml-[2.1px] flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-white/60" aria-label="Relatch home">
                <Lockup />
              </button>
              {/* Small phones (2026-11-06): labels used to wrap onto two lines (280px signed out; every phone
                  width once "Back to your skill" joined) and Sign up could leave the screen. Now no label wraps,
                  spacing tightens under 400px, "Back to your skill" says "Your skill" there, and Contact us
                  steps aside when room runs out (under 300px, or under 400px next to Your skill/s): the help menu (the ? button) keeps Contact support. */}
              <nav className="flex items-center gap-1 whitespace-nowrap max-[399px]:gap-0 sm:gap-2">
                {/* Home was reached from the workspace: this is the way back to it, for an account only.
                    Signed out there is no "Back to your skill" (Manas, 2026-11-10: never shown signed out). */}
                {isSignedIn && <button onClick={() => { setBrowsing(true); setAtHome(false); }} className="rounded-full px-3 py-1.5 text-[14px] text-fg-2 transition-colors hover:text-fg max-[399px]:px-2.5">Your skills</button>}
                <button onClick={() => openPage('contact')} className={cn('rounded-full px-3 py-1.5 text-[14px] text-fg-2 transition-colors hover:text-fg max-[399px]:px-2.5', isSignedIn ? 'max-[399px]:hidden' : 'max-[299px]:hidden')}>Contact us</button>
                <Show when="signed-out">
                  <button onClick={() => setAuth('sign-in')} className="hidden rounded-full px-3 py-1.5 text-[14px] text-fg-2 hover:text-fg sm:inline-flex">Sign in</button>
                  <button onClick={() => setAuth('sign-up')} className="rounded-full bg-white px-4 py-1.5 text-[14px] font-medium text-black hover:bg-white/90 max-[399px]:ml-1 max-[399px]:px-3.5">Sign up</button>
                </Show>
                <Show when="signed-in"><UserButton /></Show>
              </nav>
            </div>
          </header>
        )}

        {notice && (
          <div role="status" className="chrome-x fixed right-0 top-[calc(4.5rem+env(safe-area-inset-top,0px))] z-40 w-full max-w-[400px] transition-[opacity,transform] duration-300 ease-out-expo starting:-translate-y-1.5 starting:opacity-0">
            <div className="flex items-start gap-3 rounded-2xl border border-line-2 bg-ink-2/90 py-3 pl-4 pr-2 text-[13.5px] leading-snug text-fg-2 shadow-[0_18px_50px_rgb(0_0_0/0.5)] backdrop-blur-xl">
              <WarningCircleIcon size={17} className="mt-px shrink-0 text-fg" />
              <p className="flex-1">{notice}</p>
              <button onClick={() => setNotice(null)} aria-label="Dismiss" className="-mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"><XIcon size={13} /></button>
            </div>
          </div>
        )}

        {/* The drop-zone screens centre themselves in the pane. The longer ones keep clear air below. */}
        {/* A finished skill is a panel that ends at the screen's bottom edge and scrolls inside itself
            (JobStage), so the page around it must not scroll as well. */}
        <main className={cn('flex-1', composing || (job.phase === 'error' && !saved) ? 'flex flex-col' : previewing ? '' : 'pb-20')}>
          {composing ? (
            <Start key={workspace ? 'compose' : 'intro'} compact={workspace} target={target} onTarget={setTarget} onFiles={(files) => guard(() => start(files))} onSample={() => guard(sample)} />
          ) : saved ? (
            <JobStage key={saved.id} saved phase="done" parts={savedParts(saved)} target={saved.target} signedIn={!!isSignedIn} adding={FINISHED} onInstall={(name, plan) => downloaded(saved.id, saved.target, name, plan, savedParts(saved))} onAnother={() => guard(home)} onSignUp={openSignUp} />
          ) : (<>
            {(job.phase === 'thinking' || job.phase === 'done') && (
              <JobStage phase={job.phase} parts={liveParts(job.items)} target={job.target} signedIn={!!isSignedIn} adding={{ canAdd: job.canAdd, left: job.left, closed: job.closed, onAdd: addFiles, complete: job.complete }} onInstall={(name, plan) => downloaded(liveKey, job.target, name, plan, liveParts(job.items))} onAnother={() => guard(home)} onSignUp={openSignUp} resume={resume} onResumed={() => { fromUnlock.current = resume === 'download'; setResume(null); }} lock={lock} />
            )}

            {job.phase === 'error' && (
              // Centred in the pane like the drop zone (Start): a little above true centre.
              <section className="mx-auto my-auto flex max-w-[560px] flex-col items-center px-4 pb-[clamp(32px,8.5dvh,112px)] pt-[clamp(24px,6.5dvh,80px)] text-center">
                <RelatchMark state="idle" size={48} className="text-fg-2" />
                {job.error === 'quota' && (<>
                  <h2 className="mt-8 text-[30px] font-semibold tracking-[-0.03em]">You've used today's free skills.</h2>
                  <p className="mt-3 text-[16px] text-fg-2">They come back at {resetTime()}.</p>
                </>)}
                {(job.error === 'trial-used' || job.error === 'signup-needed') && (<>
                  <h2 className="mt-8 text-[30px] font-semibold tracking-[-0.03em]">Your free skill is used.</h2>
                  <p className="mt-3 text-[16px] text-fg-2">Create a free account to keep going: up to 3 skills a day.</p>
                  <button onClick={() => setAuth('sign-up')} className={cn(pill, 'mt-8 bg-white text-black hover:bg-white/90')}>Create free account</button>
                </>)}
                {/* 2026-11-17: the bot check before a free try didn't finish. Not "your free skill is used": nothing was
                    used, and trying again usually works. */}
                {job.error === 'check' && (<>
                  <h2 className="mt-8 text-[30px] font-semibold tracking-[-0.03em]">We couldn't finish a quick check.</h2>
                  <p className="mt-3 max-w-[46ch] text-[16px] text-fg-2">Relatch checks that you're not a bot before a free try, and it didn't go through. An ad blocker or a slow connection can cause this.</p>
                  <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                    {lastFiles.length > 0 && <button onClick={() => start(lastFiles)} className={cn(pill, 'bg-white text-black hover:bg-white/90')}><ArrowClockwiseIcon size={16} weight="bold" />Try again</button>}
                    <button onClick={() => setAuth('sign-up')} className={cn(pill, 'border border-line-2 text-fg hover:bg-white/[0.06]')}>Create free account</button>
                  </div>
                </>)}
                {job.error === 'busy' && (<>
                  <h2 className="mt-8 text-[30px] font-semibold tracking-[-0.03em]">Too many free tries from this network.</h2>
                  <p className="mt-3 text-[16px] text-fg-2">Create a free account to keep going: up to 3 skills a day.</p>
                  <button onClick={() => setAuth('sign-up')} className={cn(pill, 'mt-8 bg-white text-black hover:bg-white/90')}>Create free account</button>
                </>)}
                {job.error === 'failed' && unreadable(job.message) != null && (<>
                  <h2 className="mt-8 text-[30px] font-semibold tracking-[-0.03em]">{cantRead(unreadable(job.message)!)}</h2>
                  <p className="mt-3 max-w-[46ch] text-[16px] text-fg-2">{READS}</p>
                </>)}
                {job.error === 'failed' && unreadable(job.message) == null && (<>
                  <h2 className="mt-8 text-[30px] font-semibold tracking-[-0.03em]">That didn't go through.</h2>
                  <p className="mt-3 text-[16px] text-fg-2">{job.message || 'Relatch could not be reached. Check your connection and try again.'}</p>
                  {lastFiles.length > 0 && <button onClick={() => start(lastFiles)} className={cn(pill, 'mt-8 bg-white text-black hover:bg-white/90')}><ArrowClockwiseIcon size={16} weight="bold" />Try again</button>}
                </>)}
                <button onClick={home} className="mt-4 text-[14px] text-fg-2 underline decoration-white/20 underline-offset-4 hover:text-fg">Back to start</button>
              </section>
            )}
          </>)}
        </main>
      </div>

      <HelpMenu onOpen={openPage} />

      {install && <InstallDialog target={install.target} name={install.name} parts={install.parts} plan={install.plan} onClose={() => setInstall(null)} />}
      {noteOpen && <FeedbackNote target={noteTarget.current} knownEmail={isSignedIn ? user?.primaryEmailAddress?.emailAddress ?? undefined : undefined} onClose={() => setNoteOpen(false)} />}
      {account && isSignedIn && <AccountDialog onClose={() => setAccount(false)} />}
      {auth && <AuthSheet view={auth} onClose={() => setAuth(null)} />}
      {unlock && !auth && <AuthSheet view="sign-up" unlock={unlock} onClose={() => { setUnlock(null); setPendingAction(null); }} />}
      {stopAsk && <StopDialog signedIn={!!isSignedIn} onKeep={() => setStopAsk(null)} onStop={() => { const go = stopAsk; setStopAsk(null); go(); }} />}
    </div>
  );
}
