// Runs documents through the real engine (parseFile) and turns each one's progress events into the
// reasoning steps the UI shows. Every step's text comes from something the code actually knows at that
// moment; the server's own analysis (plan + content summary) is only shown once it arrives.
//
// One run is a skill SET: up to three documents, each written into its own skill file, all sent under
// one sessionId. The backend counts every call that shares a sessionId inside ten minutes as ONE skill
// (one anonymous trial, one of the three a day: relatch api/enrich.js), which is what lets a person add
// the document they went to fetch after the first one has already started, or even finished, without it
// costing a second skill. Past that window, at three documents, or once it is downloaded, the set is
// closed. Downloading is the person saying "this skill is done": the server is told, and refuses any
// further document under that sessionId (see complete()).
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { captureEvent } from '../analytics';
import { TARGET_NAME } from './logos';
import { turnstileToken } from './turnstile';
import type { Target } from './skillExport';
import { parseFile, validateInputFile, setTokenGetter, _getToken, ANON_TOKEN_URL, ANON_TOKEN_STORAGE_KEY, ANON_TRIAL_USED_KEY, ENRICH_PROXY_URL, readStorage, type EngineStage, type EnrichMeta } from '@/engine/core';

// Marks a set's sessionId complete on the server. Built in relatch#34 (api/session-complete.js, draft
// until the V3 push). Contract: POST { sessionId } with the same auth as /api/enrich (Bearer, or the
// trial token when signed out); 204, or 401 without auth. Afterwards /api/enrich refuses that sessionId
// with 409 SESSION_COMPLETE.
const SESSION_COMPLETE_URL = ENRICH_PROXY_URL.replace(/enrich$/, 'session-complete');

export type StepStatus = 'active' | 'done' | 'warn';
export interface Step { id: string; label: string; detail?: string; status: StepStatus }
export type JobPhase = 'idle' | 'thinking' | 'done' | 'error';
export type JobError = 'quota' | 'trial-used' | 'signup-needed' | 'failed';

export interface JobResult {
  fileName: string;
  content: string;
  degraded: boolean;
  meta?: EnrichMeta;
  sourceChars: number;
  seconds: number;
}

// One document in the set and the skill file being written from it.
export interface JobItem {
  id: string;
  fileName: string;
  status: 'thinking' | 'done' | 'error';
  steps: Step[];
  result: JobResult | null;
  error: JobError | null;
  message: string | null;
}

// V2's limit (FileUploadZone), and under the backend's five calls per session.
export const MAX_FILES = 3;
// The backend's window is ten minutes from the session's first call; a minute is kept in hand.
const SET_WINDOW_MS = 9 * 60 * 1000;

const FACET_WORDS: Record<string, string> = {
  ev_procedure: 'step-by-step procedures',
  ev_examples: 'worked examples',
  ev_terminology: 'key terms',
  ev_thresholds: 'thresholds and limits',
  ev_decisions: 'decision rules',
  ev_constraints: 'constraints',
  ev_voice: 'voice and tone',
};

const SIZE_WORDS: Record<string, string> = { small: 'Short document', medium: 'Medium-length document', large: 'Long document' };

export function facetPhrase(rich: unknown): string | undefined {
  if (!Array.isArray(rich) || rich.length === 0) return undefined;
  const words = rich.map((r) => FACET_WORDS[String(r)] ?? String(r).replace(/^ev_/, '').replace(/_/g, ' '));
  if (words.length > 3) return `${words.slice(0, 3).join(', ')} and ${words.length - 3} more`;
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export const countSections = (md: string) => (md.match(/^##\s+/gm) || []).length;

// 2026-11-02 (Agents target): what the backend combined for an Agents skill (meta.agents): the template
// whose domain sections it kept, and the one section the document's Codex shape added.
const LENS_WORDS: Record<string, string> = { A: "the author's voice and thinking", B: "the codebase's conventions", C: 'the process', D: "the domain's rules", E: "the data's metrics", F: 'the legal rules', G: 'the economic models', H: 'the research methods', I: 'the marketing rules', J: 'the product decisions', K: 'the people policies' };
const SHAPE_WORDS: Record<string, string> = { execute: 'final checks', specialist: 'an operating mode', expertise: 'pause points', deliverable: 'a document outline' };

export function useSkillJob(target: Target) {
  const { isSignedIn, getToken } = useAuth();
  const [items, setItems] = useState<JobItem[]>([]);
  // The set has reached its preview once. From then on it stays there while documents added later are
  // written, instead of jumping back to the thinking screen.
  const [shown, setShown] = useState(false);
  // The set was downloaded: no more documents join it.
  const [completed, setCompleted] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // `signedIn` is the set's own answer, read by runOne: add() is memoised once, so a closure's isSignedIn
  // would be the first render's (undefined while Clerk loads) and mark the free try spent for an account.
  const session = useRef<{ id: string; startedAt: number; target: Target; signedIn: boolean; access: Promise<boolean> } | null>(null);

  const patch = (id: string, fn: (it: JobItem) => JobItem) => setItems((prev) => prev.map((it) => (it.id === id ? fn(it) : it)));
  const upsert = (id: string, s: Step) => patch(id, (it) => ({ ...it, steps: it.steps.some((p) => p.id === s.id) ? it.steps.map((p) => (p.id === s.id ? s : p)) : [...it.steps, s] }));

  // Mirrors V2's requireAuth: signed-in users go straight through; a first-time visitor gets one
  // anonymous trial token; a visitor whose trial is spent is asked to sign up.
  // Checked once per set: documents added later ride on the same answer, since the server already
  // counts them as part of the same trial.
  const ensureAccess = useCallback(async (): Promise<boolean> => {
    setTokenGetter(isSignedIn ? getToken : null);
    if (isSignedIn) return true;
    try {
      if (localStorage.getItem(ANON_TRIAL_USED_KEY)) return false;
      if (localStorage.getItem(ANON_TOKEN_STORAGE_KEY)) return true;
    } catch { /* storage blocked: fall through to minting */ }
    try {
      // Cloudflare Turnstile first (turnstile.ts): '' when this build has no site key, which the backend
      // ignores while its own secret is unset
      const turnstile = await turnstileToken();
      const res = await fetch(ANON_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstile }) });
      if (!res.ok) return false;
      const { token } = await res.json();
      if (typeof token !== 'string' || !token) return false;
      try { localStorage.setItem(ANON_TOKEN_STORAGE_KEY, token); } catch { /* proceed without persisting */ }
      // Same funnel event (name and props) V2 sends, so V2 and V3 funnels compare 1:1.
      captureEvent('anon_trial_started', { session_id: readStorage('rl_session_id') });
      return true;
    } catch {
      return false;
    }
  }, [isSignedIn, getToken]);

  // reset() and a new run bump this. A file still in flight then finds it is no longer part of the
  // current set and drops its result, instead of pulling the person back to a skill they walked away from.
  const runSeq = useRef(0);

  const runOne = async (file: File, id: string, seq: number) => {
    const s = session.current!;
    const stale = () => seq !== runSeq.current;
    const startedAt = performance.now();
    const allowed = await s.access;
    if (stale()) return;
    if (!allowed) { patch(id, (it) => ({ ...it, status: 'error', error: 'signup-needed' })); return; }

    upsert(id, { id: 'read', label: 'Reading your document', detail: file.name, status: 'active' });
    let sourceChars = 0;
    let target_ = s.target;
    const onStage = (st: EngineStage) => {
      if (stale()) return;
      if (st.stage === 'extracted') {
        sourceChars = st.chars;
        upsert(id, { id: 'read', label: 'Read your document', detail: `${file.name} · ${st.chars.toLocaleString()} characters`, status: 'done' });
      } else if (st.stage === 'profiled') {
        upsert(id, { id: 'size', label: 'Sized it up', detail: SIZE_WORDS[st.sizeClass] ?? 'Document sized', status: 'done' });
      } else if (st.stage === 'sent') {
        target_ = st.target;
        upsert(id, { id: 'write', label: `Planning and writing the skill for ${st.target === 'agents' ? 'any agent' : TARGET_NAME[st.target]}`, status: 'active' });
      }
    };

    try {
      let done: Extract<EngineStage, { stage: 'done' }> | undefined;
      const file_ = await parseFile(file, s.target, s.id, (st) => { onStage(st); if (st.stage === 'done') done = st; });
      const seconds = (performance.now() - startedAt) / 1000;
      captureEvent('file_uploaded', { file_type: file_.type, file_size_mb: +(file_.size / (1024 * 1024)).toFixed(2), session_id: readStorage('rl_session_id') });
      // The server has spent the free trial whether or not anyone is still watching, so record that first.
      if (!s.signedIn) { try { localStorage.setItem(ANON_TRIAL_USED_KEY, '1'); } catch { /* ignore */ } }
      if (stale()) return;
      const meta = done?.meta;
      const plan = meta?.plan ?? {};
      const content = meta?.content ?? {};
      const sections = countSections(file_.content);

      // The server's analysis arrives all at once; reveal it as a short cascade of what it did.
      const kind = typeof plan.doc_type === 'string'
        ? `${plan.doc_type.replace(/_/g, ' ')}${typeof plan.doc_type_confidence === 'number' ? ` (${Math.round(plan.doc_type_confidence * 100)}% sure)` : ''}`
        : undefined;
      upsert(id, { id: 'write', label: `Wrote the skill for ${target_ === 'agents' ? 'any agent' : TARGET_NAME[target_]}`, detail: [kind && `Planned it as a ${kind}`, `${sections} sections`].filter(Boolean).join(' · '), status: 'done' });
      const ag = meta?.agents;
      if (target_ === 'agents' && ag && (LENS_WORDS[ag.lens ?? ''] || SHAPE_WORDS[ag.shape ?? ''])) upsert(id, { id: 'hybrid', label: [LENS_WORDS[ag.lens ?? ''] && `Kept ${LENS_WORDS[ag.lens ?? '']}`, SHAPE_WORDS[ag.shape ?? ''] && `added ${SHAPE_WORDS[ag.shape ?? '']}`].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()), detail: 'How the agent should act, on top of what your document says', status: 'done' });
      const kept = facetPhrase(plan.rich);
      const reviewed = typeof content.segments === 'number' ? `${content.segments} sections of your document reviewed${content.repeat_lines_removed ? ` · ${content.repeat_lines_removed} repeated lines dropped` : ''}` : undefined;
      if (kept || reviewed) upsert(id, { id: 'kept', label: kept ? `Kept the ${kept}` : 'Kept what matters', detail: reviewed, status: 'done' });
      upsert(id, done?.degraded
        ? { id: 'check', label: 'Used the backup writer', detail: 'The AI service was busy. Review this skill before you rely on it.', status: 'warn' }
        : { id: 'check', label: 'Checked the result', detail: 'Structure and frontmatter passed', status: 'done' });

      const result: JobResult = { fileName: file.name, content: file_.content, degraded: !!done?.degraded, meta, sourceChars, seconds };
      patch(id, (it) => ({ ...it, status: 'done', result }));
    } catch (err: any) {
      if (stale()) return;
      // parseFile rejects unreadable or unsupported files with a plain-language reason; show it.
      const plain = !err?.isQuotaError && !err?.isAnonTokenInvalid && typeof err?.message === 'string';
      patch(id, (it) => ({ ...it, status: 'error', error: err?.isQuotaError ? 'quota' : err?.isAnonTokenInvalid ? 'trial-used' : 'failed', message: plain ? err.message : null }));
    }
  };

  const start = (files: File[], seq: number) => {
    const fresh = files.map((f) => ({ id: `f_${Math.random().toString(36).slice(2, 9)}`, fileName: f.name, status: 'thinking' as const, steps: [], result: null, error: null, message: null }));
    setItems((prev) => [...prev, ...fresh]);
    fresh.forEach((it, i) => { void runOne(files[i], it.id, seq); });
  };

  // A new set. Anything past three documents is left out (the caller says so).
  const run = useCallback((files: File[]) => {
    const seq = ++runSeq.current;
    // A set with no file Relatch can read mints no trial token (2026-11-15, found live: a .png spent one of the
    // 5 tokens an IP gets an hour before parseFile said it can't read it). parseFile still shows that message.
    const readable = files.some((f) => validateInputFile(f).ok);
    session.current = { id: `v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, startedAt: Date.now(), target, signedIn: !!isSignedIn, access: readable ? ensureAccess() : Promise.resolve(true) };
    setShown(false);
    setCompleted(false);
    setItems([]);
    start(files.slice(0, MAX_FILES), seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureAccess, target, isSignedIn]);

  // More documents for the set on screen, written for the same agent under the same session.
  const add = useCallback((files: File[]) => {
    if (!session.current) return;
    start(files.slice(0, Math.max(0, MAX_FILES - itemsRef.current.length)), runSeq.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => { runSeq.current++; session.current = null; setItems([]); setShown(false); setCompleted(false); }, []);

  // The set was downloaded. The server is told too, so a document sent later under this session (a second
  // tab, a stale page) is refused there as well, not just hidden here. Best effort: the lock on this page
  // holds even if the call fails.
  const complete = useCallback(() => {
    const s = session.current;
    if (!s) return;
    setCompleted(true);
    // The same headers enrichWithAI sends: the server only shuts a session it can tie to the caller.
    void (async () => {
      const token = _getToken ? await _getToken() : null;
      let anon: string | null = null;
      if (!token) { try { anon = localStorage.getItem(ANON_TOKEN_STORAGE_KEY); } catch { /* unavailable */ } }
      await fetch(SESSION_COMPLETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(anon ? { 'X-Anon-Token': anon } : {}) },
        body: JSON.stringify({ sessionId: s.id }),
      });
    })().catch(() => {});
  }, []);

  // The window closing changes what the page offers, so re-render the moment it does.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const startedAt = session.current?.startedAt ?? 0;
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setTimeout(tick, Math.max(0, startedAt + SET_WINDOW_MS - Date.now()) + 50);
    return () => window.clearTimeout(t);
  }, [startedAt]);

  const anyDone = items.some((i) => i.status === 'done');
  const anyRunning = items.some((i) => i.status === 'thinking');
  // A batch dropped together lands together: the preview waits for every document already started.
  const phase: JobPhase = !items.length ? 'idle' : anyDone && (shown || !anyRunning) ? 'done' : anyRunning ? 'thinking' : 'error';
  useEffect(() => { if (phase === 'done' && !shown) setShown(true); }, [phase, shown]);

  const failed = items.find((i) => i.error);
  const open = !!startedAt && Date.now() - startedAt < SET_WINDOW_MS;
  const left = Math.max(0, MAX_FILES - items.length);
  // Why more documents can't be added now, if they can't.
  const closed = completed ? 'Downloaded, so this skill is complete. Start a new skill to build from more documents.'
    : !open ? 'Ten minutes have passed, so this skill is closed. Start a new skill to add more.'
    : left === 0 ? `A skill holds up to ${MAX_FILES} documents.` : null;

  return { items, phase, error: failed?.error ?? null, message: failed?.message ?? null, target: session.current?.target ?? target, run, add, reset, complete, left, canAdd: !closed && phase !== 'idle' && phase !== 'error', closed };
}
