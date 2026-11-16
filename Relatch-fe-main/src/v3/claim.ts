// The free try's unlock (2026-11-17, hybrid plan): with ANON_PREVIEW_ONLY=on an anonymous run receives a preview
// (relatch lib/anon-claim.js previewOf: the header and first sections in full, a locked note, then the remaining
// headings). Once the visitor is signed in, /api/claim returns the full skills of that run, in the order the
// server finished them, which is not the order of the documents. This matches each preview to its full skill.
// No imports on purpose: jev-harness checks it against the backend's own previewOf.

// The line previewOf puts after the part shown in full (relatch lib/anon-claim.js LOCKED_NOTE)
const LOCKED_NOTE = /\n+> The rest of this skill unlocks when you create a free account\.[^\n]*(\n|$)/;

/** The part of a preview that is word for word the start of its full skill */
export function previewPrefix(preview: string): string {
  const at = preview.search(LOCKED_NOTE);
  return (at === -1 ? preview : preview.slice(0, at)).trimEnd();
}

/**
 * For each preview, the index of its full skill in `full`, or null when the set doesn't match one to one.
 * Both sides must have been through the same clean-up (the engine's fixAiYamlFrontmatter).
 * Never guesses by position: a wrong match would hand someone the wrong document's skill.
 */
export function matchClaim(previews: string[], full: string[]): number[] | null {
  const used = new Set<number>();
  const out: number[] = [];
  for (const p of previews) {
    const prefix = previewPrefix(p);
    if (!prefix) return null;
    const i = full.findIndex((f, n) => !used.has(n) && f.startsWith(prefix));
    if (i === -1) return null;
    used.add(i);
    out.push(i);
  }
  return out;
}

// The claim waiting for this tab, kept in sessionStorage: signing up with Google or GitHub leaves the page and
// comes back to a fresh one, and the skill must still be there to unlock. `action` is what they tapped
// (download, copy, read), done for them once it's unlocked.
export type ClaimAction = 'download' | 'copy' | 'read';
export interface PendingClaim { claimId: string; target: string; at: number; action?: ClaimAction }
const KEY = 'relatch_v3_claim';
// The server keeps a held skill 24 hours (CLAIM_TTL)
const MAX_AGE_MS = 24 * 3600 * 1000;

export function readPendingClaim(): PendingClaim | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!p || typeof p.claimId !== 'string' || typeof p.at !== 'number' || Date.now() - p.at > MAX_AGE_MS) return null;
    return p;
  } catch { return null; }
}
export function writePendingClaim(p: PendingClaim | null) {
  try { if (p) sessionStorage.setItem(KEY, JSON.stringify(p)); else sessionStorage.removeItem(KEY); } catch { /* storage blocked: only the redirect case is lost */ }
}
/** The unlock sheet opened (or closed without signing in: null) for the claim waiting here, if there is one */
export function setPendingAction(action: ClaimAction | null) {
  const p = readPendingClaim();
  if (!p) return;
  const { action: _old, ...rest } = p;
  writePendingClaim(action ? { ...rest, action } : rest);
}
