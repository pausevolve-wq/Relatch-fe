// The "?" inside the help button, which every 15 seconds turns into a pair of bot eyes for a moment:
// the hook and the dot morph into two rounded eyes, the eyes glance one way, blink, glance the other,
// come back to the middle and morph back into the "?". Modelled on bencho.dev's logo (studied
// 2026-10-25: glyph -> eyes in ~0.5s, ~2.3s of looking around with one blink, eyes -> glyph in ~0.5s).
//
// Only the "?" changes; the button's circle stays as it is, like bencho's hexagon, and nothing changes
// colour: it is drawn in currentColor, so it stays the button's own grey. At rest the path is
// Phosphor's bare QuestionMark (regular) exactly. (A first version used the circled Question icon at
// 17px: a ring inside the button's own circle, with a tiny "?". Manas: too small, no inner circle.)
//
// No library: both shapes are sampled into the same number of points along their outline (hook -> left
// eye, dot -> right eye) and every frame draws the points part way between them. Skipped entirely for
// reduced motion, while the tab is hidden and while `paused` (the menu is open).
import { useEffect, useRef } from 'react';

const HOOK = 'M192,96c0,28.51-24.47,52.11-56,55.56V160a8,8,0,0,1-16,0V144a8,8,0,0,1,8-8c26.47,0,48-17.94,48-40s-21.53-40-48-40S80,73.94,80,96a8,8,0,0,1-16,0c0-30.88,28.71-56,64-56S192,65.12,192,96Z';
const DOT = 'M128,192a16,16,0,1,0,16,16A16,16,0,0,0,128,192Z';
const REST = HOOK + DOT;

const EVERY_MS = 15_000; // Manas: 50s was too long
const N = 80; // points per shape
const EYE = { w: 44, h: 88, r: 20, cy: 128 };
const EYE_X = [94, 162]; // centres: left eye (from the hook), right eye (from the dot)
const pill = (cx: number) => {
  const { w, h, r, cy } = EYE, x = cx - w / 2, y = cy - h / 2;
  return `M${x + r},${y}H${x + w - r}A${r},${r},0,0,1,${x + w},${y + r}V${y + h - r}A${r},${r},0,0,1,${x + w - r},${y + h}H${x + r}A${r},${r},0,0,1,${x},${y + h - r}V${y + r}A${r},${r},0,0,1,${x + r},${y}Z`;
};

// Where the eyes look on each run, in turn: [first glance, second glance] as unit offsets (x, y).
const GLANCES: [number, number][][] = [[[1, 0], [-1, 0]], [[-1, -0.6], [1, 0.3]], [[1, -0.6], [-1, 0.2]], [[-0.4, 0.7], [1, 0]]];
const LOOK = { x: 40, y: 24 }; // ~3.4px sideways at 22px, like bencho's glance (22 read as barely moving)
const SQUEEZE = 0.32; // mid-morph everything pulls toward the centre, so it passes through a compact blob

type Pt = [number, number];

function sample(svg: SVGSVGElement, d: string): Pt[] {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  const len = p.getTotalLength();
  const pts = Array.from({ length: N }, (_, i) => { const q = p.getPointAtLength((len * i) / N); return [q.x, q.y] as Pt; });
  p.remove();
  return pts;
}
const area = (ps: Pt[]) => ps.reduce((s, [x, y], i) => { const [x2, y2] = ps[(i + 1) % ps.length]; return s + x * y2 - x2 * y; }, 0);

// Same winding as `from`, and the starting point that makes the points travel the least.
function align(from: Pt[], to: Pt[]): Pt[] {
  const t = Math.sign(area(to)) === Math.sign(area(from)) ? to : [...to].reverse();
  let best = 0, bestCost = Infinity;
  for (let k = 0; k < N; k++) {
    let c = 0;
    for (let i = 0; i < N; i++) { const [a, b] = from[i], [x, y] = t[(i + k) % N]; c += (a - x) ** 2 + (b - y) ** 2; }
    if (c < bestCost) { bestCost = c; best = k; }
  }
  return from.map((_, i) => t[(i + best) % N]);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const outBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // a small overshoot, like bencho's pop
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const poly = (ps: Pt[]) => 'M' + ps.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';

// One run as a function of time (ms): how far the "?" has turned into eyes (0..1), where the eyes
// look, and how open they are.
function frameAt(ms: number, glance: [number, number][]) {
  const seg = (a: number, b: number) => clamp((ms - a) / (b - a));
  const morph = ms < 2850 ? outBack(seg(0, 520)) : 1 - inOut(seg(2850, 3350));
  const [g1, g2] = glance;
  const to = (from: Pt, dest: Pt, t: number): Pt => [lerp(from[0], dest[0], inOut(t)), lerp(from[1], dest[1], inOut(t))];
  let look: Pt = [0, 0];
  if (ms >= 700) look = to([0, 0], g1, seg(700, 1000));
  if (ms >= 1510) look = to(g1, g2, seg(1510, 1910));
  if (ms >= 2400) look = to(g2, [0, 0], seg(2400, 2700));
  const b = seg(1350, 1510); // the blink: shut and open again
  const open = 1 - 0.88 * Math.sin(Math.PI * b);
  return { morph, look, open, done: ms >= 3350 };
}

export function HelpGlyph({ paused }: { paused: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const inner = useRef<SVGPathElement>(null);
  const pausedRef = useRef(paused);
  const stop = useRef<() => void>(() => {});
  pausedRef.current = paused;

  // Opening the menu mid-run puts the "?" straight back.
  useEffect(() => { if (paused) stop.current(); }, [paused]);

  useEffect(() => {
    if (!svg.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let shapes: { src: Pt[][]; eyes: Pt[][] } | null = null;
    let raf = 0, run = 0, timer = 0;
    const restore = () => { cancelAnimationFrame(raf); raf = 0; inner.current?.setAttribute('d', REST); };
    stop.current = restore;

    const play = () => {
      const el = svg.current, path = inner.current;
      if (!el || !path || raf || pausedRef.current || document.hidden) return;
      if (!shapes) {
        const src = [sample(el, HOOK), sample(el, DOT)];
        shapes = { src, eyes: EYE_X.map((cx, i) => align(src[i], sample(el, pill(cx)))) };
      }
      const { src, eyes } = shapes;
      const glance = GLANCES[run++ % GLANCES.length];
      const t0 = performance.now();
      const tick = (now: number) => {
        const f = frameAt(now - t0, glance);
        if (f.done) { restore(); return; }
        const dx = f.look[0] * LOOK.x, dy = f.look[1] * LOOK.y, cy = EYE.cy + dy;
        const s = 1 - SQUEEZE * Math.sin(Math.PI * clamp(f.morph));
        path.setAttribute('d', src.map((s0, k) => poly(s0.map(([x, y], i) => {
          const [ex, ey] = eyes[k][i];
          const px = lerp(x, ex + dx, f.morph), py = lerp(y, cy + (ey - EYE.cy) * f.open, f.morph);
          return [128 + (px - 128) * s, 128 + (py - 128) * s] as Pt;
        }))).join(''));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const schedule = () => { timer = window.setTimeout(() => { play(); schedule(); }, EVERY_MS); };
    schedule();
    return () => { clearTimeout(timer); restore(); };
  }, []);

  return (
    <svg ref={svg} viewBox="0 0 256 256" width={22} height={22} fill="currentColor" aria-hidden="true">
      <path ref={inner} d={REST} />
    </svg>
  );
}
