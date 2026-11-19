// The skills a person has made, so the sidebar can list them and open them again.
//
// Only the finished skill file is kept: its name, who it is for, when, and its text. The document it
// was made from, that document's file name and its extracted text are never stored.
//
// Where it lives (2026-10-25): in the person's account, through relatch's /api/skills (relatch#34,
// Neon), with a copy in this browser so the sidebar shows instantly and keeps working offline. This is
// runbook Flows C and D ("Relatch Infra System Design & Runbook (2026-10-21)" in the vault):
// - the local copy is per account (a key with the user id), so two people sharing a browser never see,
//   or upload, each other's skills;
// - a skill is saved here first, then sent with PUT /api/skills/:id. PUT is idempotent (same id = same
//   row), so a failed save simply stays "not synced" and is sent again on the next app open;
// - opening the app refreshes from GET /api/skills: skills made on another device are fetched, and a
//   synced skill the server no longer has (deleted elsewhere) is dropped here too;
// - deletes are queued until the server confirms them, so an offline delete cannot come back;
// - when the server has history switched off (404) or cannot be reached, everything stays local.
import type { Target } from './skillExport';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { ENRICH_PROXY_URL } from '@/engine/core';
import { captureEvent } from '../analytics';

export interface SavedSkill {
  id: string;
  name: string;
  target: Target;
  createdAt: number;
  content: string;
  seconds: number;
  degraded: boolean;
  // A skill built from several documents: each skill file, named after its own skill (never after the
  // document it came from). `content` then repeats the first one, so older readers still find a skill.
  files?: { name: string; content: string; degraded: boolean }[];
  // When the account last confirmed this exact version (ms). Unset = only in this browser so far.
  syncedAt?: number;
}

const SKILLS_URL = ENRICH_PROXY_URL.replace(/enrich$/, 'skills');
const MAX = 30;
const keyFor = (uid: string) => `relatch_v3_skills:${uid}`;
// Ids deleted here that the server has not confirmed yet; '*' = the whole history was cleared.
const pendingKeyFor = (uid: string) => `relatch_v3_skills_deleted:${uid}`;

function readList<T>(key: string, ok: (v: T) => boolean): T[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter(ok) : [];
  } catch {
    return [];
  }
}
function writeList<T>(key: string, list: T[]) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage full or blocked: the list still works for this visit */ }
  return list;
}
const load = (uid: string | null): SavedSkill[] => (uid ? readList<SavedSkill>(keyFor(uid), (s) => !!s && typeof s.id === 'string' && typeof s.content === 'string') : []);
const loadPending = (uid: string): string[] => readList<string>(pendingKeyFor(uid), (x) => typeof x === 'string');

// What makes one version of a skill different from the next (a document added to it, a rename).
const versionOf = (s: SavedSkill) => `${s.name}|${(s.files ?? []).length}|${s.content.length}|${(s.files ?? []).map((f) => f.content.length).join(',')}`;

// The body /api/skills validates (relatch api/skills.js validateSkill): names 1-120, 1-3 files.
const toBody = (s: SavedSkill) => ({
  name: s.name.slice(0, 120),
  target: s.target,
  seconds: s.seconds,
  degraded: s.degraded,
  files: (s.files ?? [{ name: s.name, content: s.content, degraded: s.degraded }]).slice(0, 3).map((f) => ({ name: f.name.slice(0, 120), content: f.content, degraded: f.degraded })),
});

interface ServerFull { id: string; name: string; target: Target; createdAt: string; seconds: number | null; degraded: boolean; files: { name: string; content: string; degraded: boolean }[] }
const fromServer = (r: ServerFull, at: number): SavedSkill => ({
  id: r.id, name: r.name, target: r.target, createdAt: Date.parse(r.createdAt) || at, content: r.files[0]?.content ?? '',
  seconds: r.seconds ?? 0, degraded: r.degraded, files: r.files.length > 1 ? r.files : undefined, syncedAt: at,
});

export function useSkillHistory() {
  const { isSignedIn, userId, getToken } = useAuth();
  const uid = isSignedIn && userId ? userId : null;
  const [skills, setSkills] = useState<SavedSkill[]>(() => load(uid));
  // Read through refs: the async work below must act for the account it started for, and Clerk's
  // getToken identity changes between renders.
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  // Versions already sent (or being sent) in this visit, by id, so a failed save waits for the next
  // app open instead of being retried on every change.
  const sent = useRef(new Map<string, string>());
  // 2026-11-19 (PostHog rebuild): what is on the list now, for the skill_deleted event (who it was for, how old)
  const skillsRef = useRef(skills);
  skillsRef.current = skills;

  // Every change goes to this account's local copy, and is dropped if the account changed meanwhile.
  const commit = useCallback((forUid: string, change: (prev: SavedSkill[]) => SavedSkill[]) => {
    if (uidRef.current !== forUid) return;
    setSkills((prev) => writeList(keyFor(forUid), change(prev)));
  }, []);

  // null = no token, no network, or no answer: the caller keeps the local state.
  const call = useCallback(async (method: string, path = '', body?: unknown): Promise<Response | null> => {
    try {
      const token = await tokenRef.current();
      if (!token) return null;
      return await fetch(SKILLS_URL + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      return null;
    }
  }, []);

  const flushDeletes = useCallback(async (forUid: string) => {
    for (const id of loadPending(forUid)) {
      const res = await call('DELETE', id === '*' ? '' : `/${encodeURIComponent(id)}`);
      if (res?.status === 204) writeList(pendingKeyFor(forUid), loadPending(forUid).filter((p) => p !== id));
    }
  }, [call]);

  // Opening the app (or signing in): show this account's local copy at once, then refresh it.
  useEffect(() => {
    sent.current = new Map();
    setSkills(load(uid));
    if (!uid) return;
    let live = true;
    (async () => {
      await flushDeletes(uid);
      const askedAt = Date.now();
      const res = await call('GET');
      if (!live || !res?.ok) return; // history off (404), offline or down: stay local
      const list = (await res.json().catch(() => null)) as { id: string; name: string }[] | null;
      if (!Array.isArray(list)) return;
      const pending = new Set(loadPending(uid));
      const onServer = new Map(list.filter((r) => !pending.has(r.id) && !pending.has('*')).map((r) => [r.id, r]));
      const known = new Set(load(uid).map((s) => s.id));
      // Made on another device: fetch them whole, a few at a time.
      const fetched: SavedSkill[] = [];
      const missing = [...onServer.keys()].filter((id) => !known.has(id));
      for (let i = 0; i < missing.length && live; i += 4) {
        const got = await Promise.all(missing.slice(i, i + 4).map(async (id) => {
          const r = await call('GET', `/${encodeURIComponent(id)}`);
          const full = r?.ok ? ((await r.json().catch(() => null)) as ServerFull | null) : null;
          return full && Array.isArray(full.files) && full.files.length ? fromServer(full, Date.now()) : null;
        }));
        fetched.push(...got.filter((s): s is SavedSkill => !!s));
      }
      if (!live) return;
      commit(uid, (prev) => {
        // A synced skill the server no longer lists was deleted elsewhere. Only one confirmed BEFORE
        // the list was asked for counts: a save that lands while the list is in flight is kept.
        const kept = prev
          .filter((s) => onServer.has(s.id) || !s.syncedAt || s.syncedAt >= askedAt)
          .map((s) => (onServer.has(s.id) && s.syncedAt ? { ...s, name: onServer.get(s.id)!.name } : s));
        const ids = new Set(kept.map((s) => s.id));
        return [...kept, ...fetched.filter((s) => !ids.has(s.id))].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX);
      });
    })();
    return () => { live = false; };
  }, [uid, call, commit, flushDeletes]);

  // Send every version the account has not confirmed yet (a new skill, a document added, an unsynced
  // one from an earlier visit). Marked synced only if it is still the version that was sent.
  useEffect(() => {
    if (!uid) return;
    const due = skills.filter((s) => !s.syncedAt && sent.current.get(s.id) !== versionOf(s));
    if (!due.length) return;
    for (const s of due) sent.current.set(s.id, versionOf(s));
    void (async () => {
      // A clear the server has not confirmed must land first: run later, it would wipe these saves.
      if (loadPending(uid).includes('*')) await flushDeletes(uid);
      if (loadPending(uid).includes('*')) return; // still unconfirmed: these wait for the next app open
      await Promise.all(due.map(async (s) => {
        const v = versionOf(s);
        const res = await call('PUT', `/${encodeURIComponent(s.id)}`, toBody(s));
        if (res?.ok) commit(uid, (prev) => prev.map((p) => (p.id === s.id && versionOf(p) === v ? { ...p, syncedAt: Date.now() } : p)));
      }));
    })();
  }, [skills, uid, call, commit, flushDeletes]);

  const add = useCallback((s: SavedSkill) => {
    const forUid = uidRef.current;
    if (!forUid) return;
    commit(forUid, (prev) => [{ ...s, syncedAt: undefined }, ...prev.filter((p) => p.id !== s.id)].slice(0, MAX));
  }, [commit]);

  const remove = useCallback((id: string) => {
    const forUid = uidRef.current;
    if (!forUid) return;
    const gone = skillsRef.current.find((p) => p.id === id);
    captureEvent('skill_deleted', { scope: 'one', count: 1, target: gone?.target, age_hours: gone ? Math.round((Date.now() - gone.createdAt) / 3_600_000) : undefined, left: Math.max(0, skillsRef.current.length - 1) });
    commit(forUid, (prev) => prev.filter((p) => p.id !== id));
    writeList(pendingKeyFor(forUid), [...loadPending(forUid).filter((p) => p !== id), id]);
    void flushDeletes(forUid);
  }, [commit, flushDeletes]);

  const clear = useCallback(() => {
    const forUid = uidRef.current;
    if (!forUid) return;
    const all = skillsRef.current;
    captureEvent('skill_deleted', { scope: 'all', count: all.length, claude: all.filter((s) => s.target === 'claude').length, codex: all.filter((s) => s.target === 'codex').length, agents: all.filter((s) => s.target === 'agents').length, left: 0 });
    commit(forUid, () => []);
    writeList(pendingKeyFor(forUid), ['*']);
    void flushDeletes(forUid);
  }, [commit, flushDeletes]);

  return { skills, add, remove, clear };
}
