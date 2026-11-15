/*! Relatch MarkBuddy. Eye tracking adapted from signup-buddy, Copyright (c) 2026 Adrien Ninet, MIT
 *  (github.com/Logiaweb/signup-buddy), itself adapted from Bencho's eye tracker, MIT (bencho.dev/licence).
 *  Full licence text: src/v3/auth/THIRD_PARTY_NOTICES.md */
//
// The Relatch mark as a character for the sign-up sheet. Its face is the dark square where the four
// latch pieces meet (measured on the logo: x 34-64, y 36-64 of the 0..100 mark, centred on 50,50):
// two white eyes live in that window.
//   watch - the pieces part a little (the window opens) and the eyes follow the text cursor
//   shut  - for the password: the latch closes to the logo's own shape and the eyes shut, looking away
//   busy  - sending or checking a code: the product's own thinking turn (pieces part, quarter turn, close),
//           finishing forward to the logo's own orientation
//   idle  - a slow breath, eyes on the pointer
//   doubt - the email looks wrong or is a throwaway: the latch tightens and the eyes narrow unevenly
//           (one lower than the other, a sceptical look), still following the text cursor while it's fixed
//   eager - the unlock sheet (2026-11-15): the latch stands wide open with a little bob and the eyes are
//           bigger, keen on the skill it is holding for them
//   glee  - unlocked: both eyes squint up in a smile while the latch turns home
// Each eye is a point on a small sphere behind the window: the gaze turns the sphere, and an eye heading
// for the rim moves less and narrows, which makes the flat window read as round (Bencho's idea).
//
// Alive, not a slideshow (2026-11-06, Manas: the eyes looked "like a series of stale and stagnant images").
// Measured before this change: with the pointer still the eyes were frozen 100% of frames, and 78% while a
// field had focus; every hop/shake remounted the SVG. Now: an always-on wander (three incommensurate
// waves, so it never repeats or stops), unprompted glances when the pointer rests, a blink that closes
// fast and opens slow (sometimes twice, and with big glances), a breath in the eyes, hops/shakes restarted
// on the same element, and the pointer read once per frame instead of on every pointermove.
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { MARK_PIECES } from '../markPieces';
import { cn } from '@/lib/utils';

export type BuddyMood = 'idle' | 'watch' | 'shut' | 'busy' | 'doubt' | 'eager' | 'glee';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const C = 50;
/** Half the face window at rest, in mark units */
const WINDOW = 14.5;
const EYE = { w: 10, h: 15, r: 5 };
/** The sphere the eyes sit on, and how far apart they sit on it */
const SPHERE = 10;
const SPREAD = 0.55;
const TILT = 40;
const FOLLOW = 0.6;
const BOUNCE = 30;
/** How far the whole mark leans toward what it looks at */
const LEAN = 2.4;
/** The wander's reach (sphere units, the gaze runs about -0.9..0.9): wider when free, small on a field */
const WANDER = { idle: 0.18, watch: 0.06 };
/** Doubt: how open each eye stays (left, right), so one sits lower than the other */
const DOUBT_LIDS = [0.42, 0.7];
/** Glee: both eyes squint the same way, a smile; Eager: how much bigger the eyes grow */
const GLEE_LIDS = [0.34, 0.34];
const EAGER_EYES = 1.14;
/** The pointer has rested this long: the mark starts looking around on its own */
const GLANCE_AFTER = 2500;
const BLINK_CLOSE = 70;
const BLINK_OPEN = 130;

/** A smooth value in about -1..1 that never repeats: three sines at unrelated speeds */
const drift = (t: number, a: number, b: number, c: number, p: number) =>
  0.55 * Math.sin(t * a + p) + 0.3 * Math.sin(t * b + p * 2.3) + 0.15 * Math.sin(t * c + p * 0.7);

/** Restarts a CSS animation class on the same element (a key change would rebuild the SVG and snap the eyes) */
function useReplay(ref: RefObject<HTMLSpanElement | null>, className: string, count: number) {
  useEffect(() => {
    const el = ref.current;
    if (!el || count === 0) return;
    el.classList.remove(className);
    void el.offsetWidth; // a reflow, so the browser treats the next add as a new animation
    el.classList.add(className);
  }, [ref, className, count]);
}

export function MarkBuddy({
  size = 64,
  className,
  mood = 'idle',
  gaze = null,
  say,
  hops = 0,
  shakes = 0,
  turns = 0,
}: {
  /** Pixels; 0 leaves the size to className */
  size?: number;
  className?: string;
  mood?: BuddyMood;
  /** A point on screen to look at instead of the pointer, e.g. the text cursor */
  gaze?: { x: number; y: number } | null;
  /** Types this line into the bubble beside it; "" hides the bubble */
  say?: string;
  /** Raise to hop, shake the head, or spin one full turn home (the latch settling, on success) */
  hops?: number;
  shakes?: number;
  turns?: number;
}) {
  const clipId = `mark-buddy-${useId()}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const piecesRef = useRef<SVGGElement>(null);
  const pieceRefs = useRef<(SVGGElement | null)[]>([]);
  const eyeRefs = useRef<(SVGRectElement | null)[]>([]);
  const windowRef = useRef<SVGRectElement>(null);
  const hopRef = useRef<HTMLSpanElement>(null);
  const shakeRef = useRef<HTMLSpanElement>(null);
  useReplay(hopRef, 'mb-hop', hops);
  useReplay(shakeRef, 'mb-shake', shakes);
  const [line, setLine] = useState('');
  const [talking, setTalking] = useState(false);
  // The loop reads these each frame
  const live = useRef({ mood, gaze, turns });
  useEffect(() => { live.current = { mood, gaze, turns }; }, [mood, gaze, turns]);

  // Types a line into the bubble; a newer line or hush() cancels it
  const run = useRef(0);
  const speak = useCallback(async (text: string) => {
    const id = ++run.current;
    for (let i = 0; i <= text.length; i++) {
      await new Promise((done) => window.setTimeout(done, i ? 30 + Math.random() * 26 : 0));
      if (id !== run.current) return;
      setTalking(true);
      setLine(text.slice(0, i));
    }
  }, []);
  const hush = useCallback(() => { run.current++; setTalking(false); }, []);
  // Closing the sheet mid-line stops the typing loop (it checks run.current before every setState)
  useEffect(() => () => { run.current++; }, []);
  useEffect(() => {
    if (say === undefined) return;
    if (say) return void speak(say);
    const timer = window.setTimeout(hush);
    return () => window.clearTimeout(timer);
  }, [say, speak, hush]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    let frame = 0;
    let last = 0;
    let blinkAt = 0;
    let nextBlink = performance.now() + 2200;
    let lid = 1;
    let open = 1;
    // Each eye's own lid on top of the shared one (only doubt sets them apart)
    const eyeLid = [1, 1];
    // Eye size on top of the sphere's shading (only eager grows it), and how high a smile lifts them
    let eyeScale = 1;
    let lift = 0;
    let rot = 0;
    let rotTarget = 0;
    let seenTurns = live.current.turns;
    let busySince = 0;
    let busyFrom = 0;
    // The pointer, as last seen; read once per frame, never measured inside pointermove
    let pointer: { x: number; y: number } | null = null;
    let movedAt = performance.now();
    let nextGlance = 0;
    let glance: { x: number; y: number } | null = null;
    let box = root.getBoundingClientRect();
    let boxAt = 0;

    function aimAt(x: number, y: number, max = 0.85) {
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const amount = Math.min(max, Math.tanh(dist / 240) * FOLLOW * 1.5);
      s.tx = (dx / dist) * amount;
      s.ty = (dy / dist) * amount;
    }

    function blink(now: number) {
      blinkAt = now;
      // Now and then a double blink, the way people do
      nextBlink = Math.random() < 0.15 ? now + 230 : now + 2600 + Math.random() * 3200;
    }

    /** The pointer has rested: look somewhere on its own - back at the pointer, at you, or around */
    function pickGlance(now: number) {
      const r = Math.random();
      const from = glance ?? { x: s.tx, y: s.ty };
      if (r < 0.4 && pointer) { glance = null; aimAt(pointer.x, pointer.y); }
      else if (r < 0.6) { glance = { x: 0, y: 0.06 }; }
      else {
        const a = Math.random() * Math.PI * 2;
        const d = 0.25 + Math.random() * 0.35;
        glance = { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7 };
      }
      const to = glance ?? { x: s.tx, y: s.ty };
      // A big look-away often comes with a blink
      if (Math.hypot(to.x - from.x, to.y - from.y) > 0.4 && Math.random() < 0.6) blink(now);
      nextGlance = now + 1800 + Math.random() * 2800;
    }

    function tick(now: number) {
      const dt = last ? Math.min(2.5, (now - last) / 16.67) : 1;
      last = now;
      const { mood: m, gaze: g, turns: t } = live.current;

      // Where the mark sits on screen: re-measured a few times a second, not on every event
      if (now - boxAt > 400) { box = root!.getBoundingClientRect(); boxAt = now; }

      // Where to look
      if (m === 'shut') { s.tx = 0.3; s.ty = -0.5; }
      else if (m === 'busy') { s.tx = 0; s.ty = 0; }
      else if (g) aimAt(g.x, g.y, 0.55);
      else if (now - movedAt > GLANCE_AFTER && !reduced) {
        if (now > nextGlance) pickGlance(now);
        if (glance) { s.tx = glance.x; s.ty = glance.y; }
      } else if (pointer) { glance = null; nextGlance = 0; aimAt(pointer.x, pointer.y); }

      // Life on top of the target: a slow wander that never repeats and never stops
      const reach = reduced || m === 'shut' || m === 'busy' ? 0 : m === 'idle' || m === 'eager' ? WANDER.idle : WANDER.watch;
      const wx = reach * drift(now, 0.00071, 0.00173, 0.0041, 1.3);
      const wy = reach * 0.7 * drift(now, 0.00059, 0.00191, 0.0037, 0.2);

      // How open the latch is, how open the eyes are, and the quarter turns
      let openTarget = 1 + 0.7 * Math.sin(now / 1100);
      let lidTarget = 1;
      if (m === 'watch') openTarget = 2.4;
      // Doubt: the latch draws in a little, less open than watching
      if (m === 'doubt') openTarget = 0.6;
      // Eager: wide open with a quick bob; glee: open and still, the smile does the talking
      if (m === 'eager') openTarget = 3 + 0.6 * Math.sin(now / 420);
      if (m === 'glee') openTarget = 2.2;
      // Exactly the logo: pressing the pieces further in merges them and loses the mark
      if (m === 'shut') { openTarget = 0; lidTarget = 0.06; }
      if (m === 'busy') {
        if (!busySince) { busySince = now; busyFrom = Math.round(rot / 90) * 90; }
        // One cycle every 1.5s: part, turn a quarter, close
        const elapsed = now - busySince;
        const cycle = (elapsed % 1500) / 1500;
        openTarget = cycle < 0.6 ? 6 : 0.8;
        lidTarget = 0.35;
        rotTarget = busyFrom + 90 * (Math.floor(elapsed / 1500) + (cycle > 0.15 ? 1 : 0));
      } else if (busySince) {
        // Turn on, forward, to the logo's own orientation: a quarter-turned mark reads as a different shape
        busySince = 0;
        rotTarget = Math.ceil(rot / 360 - 0.01) * 360;
      }
      if (t !== seenTurns) {
        // Success: one full turn home, the latch parting and settling shut as it lands
        rotTarget = Math.ceil(rotTarget / 360 - 0.01) * 360 + 360 * (t - seenTurns);
        seenTurns = t;
        open = 5; // the pieces part for the turn and latch back shut
      }

      // Blink: the lid drops fast and lifts slower, the way a real one does
      if (now > nextBlink) blink(now);
      const sinceBlink = now - blinkAt;
      let eyeOpen = 1;
      if (!reduced && sinceBlink < BLINK_CLOSE) eyeOpen = 1 - 0.92 * (sinceBlink / BLINK_CLOSE) ** 2;
      else if (!reduced && sinceBlink < BLINK_CLOSE + BLINK_OPEN) eyeOpen = 0.08 + 0.92 * (1 - (1 - (sinceBlink - BLINK_CLOSE) / BLINK_OPEN) ** 2);

      eyeLid.forEach((v, i) => {
        const target = m === 'doubt' ? DOUBT_LIDS[i] : m === 'glee' ? GLEE_LIDS[i] : 1;
        eyeLid[i] = reduced ? target : v + (target - v) * Math.min(1, 0.2 * dt);
      });
      const scaleTarget = m === 'eager' ? EAGER_EYES : 1;
      const liftTarget = m === 'glee' ? -2.2 : 0;
      eyeScale = reduced ? scaleTarget : eyeScale + (scaleTarget - eyeScale) * Math.min(1, 0.18 * dt);
      lift = reduced ? liftTarget : lift + (liftTarget - lift) * Math.min(1, 0.2 * dt);
      if (reduced) {
        s.x = s.tx; s.y = s.ty; open = openTarget; lid = lidTarget; rot = rotTarget;
      } else {
        const damping = 0.34 - (BOUNCE / 100) * 0.22;
        s.vx += ((s.tx + wx - s.x) * 0.06 - s.vx * damping) * dt;
        s.vy += ((s.ty + wy - s.y) * 0.06 - s.vy * damping) * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        open += (openTarget - open) * Math.min(1, 0.14 * dt);
        lid += (lidTarget - lid) * Math.min(1, 0.25 * dt);
        rot += (rotTarget - rot) * Math.min(1, 0.11 * dt);
      }
      eyeOpen *= lid;

      // The mark: every piece leans toward the gaze and parts along its own diagonal
      const hx = s.x * LEAN;
      const hy = s.y * LEAN;
      piecesRef.current?.setAttribute('transform', `rotate(${rot.toFixed(2)} ${C} ${C})`);
      pieceRefs.current.forEach((el, i) => {
        if (!el) return;
        const p = MARK_PIECES[i];
        el.setAttribute('transform', `translate(${(p.dx * open + hx).toFixed(2)} ${(p.dy * open + hy).toFixed(2)})`);
      });

      // The face window grows and shrinks with the latch; the eyes are clipped to it
      const half = Math.max(7, WINDOW + open);
      const win = windowRef.current;
      if (win) {
        win.setAttribute('x', (C + hx - half).toFixed(2));
        win.setAttribute('y', (C + hy - half).toFixed(2));
        win.setAttribute('width', (half * 2).toFixed(2));
        win.setAttribute('height', (half * 2).toFixed(2));
      }

      const yaw = Math.asin(clamp(s.x, -0.92, 0.92));
      const pitch = -Math.asin(clamp(s.y, -0.92, 0.92));
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const tilt = TILT * s.x * s.y;
      // The eyes breathe with the latch (the same 1.1s wave that opens it at rest)
      const breath = reduced || m !== 'idle' ? 1 : 1 + 0.03 * Math.sin(now / 1100);
      [-SPREAD, SPREAD].forEach((x0, i) => {
        const eye = eyeRefs.current[i];
        if (!eye) return;
        const z0 = Math.sqrt(1 - x0 * x0);
        const x1 = x0 * cy + z0 * sy;
        const z1 = -x0 * sy + z0 * cy;
        const y2 = -z1 * sp;
        const z2 = z1 * cp;
        const depth = clamp(z2, 0, 1);
        const sh = 0.45 + 0.55 * depth;
        const w = EYE.w * sh * (0.7 + 0.3 * depth) * eyeScale;
        const h = Math.max(0.6, EYE.h * sh * eyeOpen * eyeLid[i] * breath * eyeScale);
        const ex = C + hx * 1.6 + x1 * SPHERE;
        const ey = C + hy * 1.6 + y2 * SPHERE + lift;
        eye.setAttribute('x', (-w / 2).toFixed(2));
        eye.setAttribute('y', (-h / 2).toFixed(2));
        eye.setAttribute('width', w.toFixed(2));
        eye.setAttribute('height', h.toFixed(2));
        eye.setAttribute('rx', Math.min(EYE.r, w / 2, h / 2).toFixed(2));
        eye.setAttribute('transform', `translate(${ex.toFixed(2)} ${ey.toFixed(2)}) rotate(${tilt.toFixed(2)})`);
        // Fades out over the sphere's rim instead of blinking off in one frame
        eye.style.opacity = clamp((z2 - 0.02) / 0.18, 0, 1).toFixed(2);
      });

      frame = requestAnimationFrame(tick);
    }

    // Only remember the pointer here; the frame loop does the looking
    function onMove(e: PointerEvent) {
      pointer = { x: e.clientX, y: e.clientY };
      movedAt = performance.now();
    }
    function onLeave() { pointer = null; s.tx = 0; s.ty = 0; }

    frame = requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    // size 0: sized by className instead (the error screens' responsive size)
    <span ref={rootRef} aria-hidden className={cn('relative block shrink-0', className)} style={size ? { width: size, height: size } : undefined}>
      <span
        className={cn(
          'pointer-events-none absolute left-[calc(100%+12px)] top-1/2 flex min-h-[32px] origin-left -translate-y-1/2 items-center whitespace-nowrap rounded-[14px] rounded-bl-[6px] bg-white px-3.5 text-[13px] font-medium text-black shadow-[0_10px_24px_-10px_rgba(0,0,0,0.6)] transition-[opacity,scale] duration-200',
          talking ? 'scale-100 opacity-100' : 'scale-90 opacity-0',
        )}
      >
        {line}
      </span>
      {/* useReplay restarts the hop and the shake on these same elements (no remount, so no snap) */}
      <span ref={shakeRef} className="block h-full w-full">
        <span ref={hopRef} className="block h-full w-full">
          <svg viewBox="-12 -12 124 124" className="h-full w-full overflow-visible text-white">
            <clipPath id={clipId}>
              <rect ref={windowRef} x={C - WINDOW} y={C - WINDOW} width={WINDOW * 2} height={WINDOW * 2} rx={3} />
            </clipPath>
            <g ref={piecesRef}>
              {MARK_PIECES.map((p, i) => (
                <g key={p.id} ref={(el) => { pieceRefs.current[i] = el; }}>
                  <path d={p.d} fill="currentColor" />
                </g>
              ))}
            </g>
            <g clipPath={`url(#${clipId})`}>
              {[0, 1].map((i) => (
                <rect
                  key={i}
                  ref={(el) => { eyeRefs.current[i] = el; }}
                  x={-EYE.w / 2}
                  y={-EYE.h / 2}
                  width={EYE.w}
                  height={EYE.h}
                  rx={EYE.r}
                  transform={`translate(${C + (i ? SPREAD : -SPREAD) * SPHERE} ${C})`}
                  fill="currentColor"
                />
              ))}
            </g>
          </svg>
        </span>
      </span>
    </span>
  );
}
