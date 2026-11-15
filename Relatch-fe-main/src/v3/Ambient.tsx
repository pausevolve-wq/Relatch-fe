// The page's ambient light: a still dot grid that fades out from the hero, and one slow warm
// spotlight drifting across it (.ambient-spot in v3.css). Fixed on every screen, never interactive.
//
// Paint order is deliberate: it is positioned (z-0) and comes first in the tree, so it sits under
// anything positioned (header, drop zone) but washes faintly over plain in-flow surfaces. That is why
// the thinking and preview cards look lit from within instead of reading as flat slabs on a dotted page.
//
// While `live` (the start screen), the element marked [data-ambient-origin] (the drop zone) breathes
// into the grid: soft crests of light leave its edge and travel outward through the same dots, keeping
// its rounded shape and passing around the copy, never under it. Nothing new is drawn. The canvas only
// brightens dots that are already there, so off the start screen, or with reduced motion, the page is
// exactly the still grid.
//
// `dots={false}` fades the whole grid out (a finished skill is on screen: text reads better on a clean
// surface). `still` holds the warm light where it is (the person turned background motion off).
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const PITCH = 28;       // the lattice of #ambient-dots below; the two must agree
const INSET = 1.5;      // where a dot sits inside its cell
const TAU = Math.PI * 2;

const SPEED = 46;       // px/s a crest travels
const WAVELENGTH = 280; // px between crests, so one leaves the card about every six seconds
const PEAK = 0.22;      // the brightest a lit dot gets (still dots are 0.055): half the dimmest text, never more

export function Ambient({ live = false, dots = true, still = false }: { live?: boolean; dots?: boolean; still?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef(live);
  const wake = useRef(() => {});

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let reach = 0;                  // px from the origin's edge where a crest has fully died out
    let dist = new Float32Array(0); // per dot: px outside the origin's rounded edge (<= 0 inside it)
    let box = '';                   // the origin rect `dist` was measured for
    let energy = 0;                 // 0..1, eases after how visible the origin is
    let raf = 0;
    let last = 0;

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / PITCH);
      rows = Math.ceil(h / PITCH);
      // Wide screens have margins for the light to cross; on a phone it has to stop short of the copy.
      reach = Math.min(460, Math.max(w, h) * 0.32);
      dist = new Float32Array(cols * rows);
      box = '';
    };

    // Signed distance from every dot to the origin's rounded rectangle. Dots under `quiet` (the copy
    // around the origin) are left at 0, so they never light: a lit dot on a text baseline reads as a
    // stray full stop.
    const measure = (r: DOMRect, radius: number, quiet: DOMRect[]) => {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hx = r.width / 2 - radius;
      const hy = r.height / 2 - radius;
      for (let j = 0, k = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++, k++) {
          const x = i * PITCH + INSET;
          const y = j * PITCH + INSET;
          if (quiet.some((q) => x > q.left - 8 && x < q.right + 8 && y > q.top - 8 && y < q.bottom + 8)) { dist[k] = 0; continue; }
          const qx = Math.abs(x - cx) - hx;
          const qy = Math.abs(y - cy) - hy;
          dist[k] = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
        }
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 30) return; // light this slow does not need more than ~30fps
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const el = liveRef.current ? document.querySelector<HTMLElement>('[data-ambient-origin]') : null;
      let seen = 0;
      if (el) {
        // The intro holds the drop zone hidden, then scales it in: follow both, so no light leaves
        // a card that is not there yet.
        const cs = getComputedStyle(el);
        seen = cs.visibility === 'hidden' ? 0 : parseFloat(cs.opacity) || 0;
        const r = el.getBoundingClientRect();
        // The origin's siblings are the headline, the line under it, the switch and the sample row.
        const quiet = Array.from(el.parentElement?.children ?? []).filter((s) => s !== el).map((s) => s.getBoundingClientRect());
        const sig = [r, ...quiet].map((q) => `${Math.round(q.left)},${Math.round(q.top)},${Math.round(q.width)},${Math.round(q.height)}`).join(';');
        if (sig !== box) { box = sig; measure(r, parseFloat(cs.borderTopLeftRadius) || 0, quiet); }
      }
      energy += (seen - energy) * Math.min(1, dt * 1.6);

      ctx.clearRect(0, 0, w, h);
      if (!el && energy < 0.01) { // faded out: sleep until `live` wakes it
        energy = 0;
        cancelAnimationFrame(raf);
        raf = 0;
        return;
      }

      const shift = (now / 1000) * SPEED;
      ctx.fillStyle = '#fff4e6'; // the spotlight's warm white
      for (let j = 0, k = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++, k++) {
          const d = dist[k];
          if (d <= 0 || d >= reach) continue;
          const crest = (0.5 + 0.5 * Math.cos(((d - shift) / WAVELENGTH) * TAU)) ** 3;
          const fall = 1 - d / reach;
          const a = PEAK * crest * fall * Math.sqrt(fall) * Math.min(1, d / 24) * energy;
          if (a < 0.006) continue;
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(i * PITCH + INSET, j * PITCH + INSET, 1 + 0.3 * crest, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    wake.current = () => { if (!raf) raf = requestAnimationFrame(frame); };
    // Observed rather than a window resize listener: a scrollbar arriving narrows this layer without one,
    // and a canvas stretched to a new size would slide its dots off the still ones.
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    wake.current();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wake.current = () => {};
    };
  }, []);

  useEffect(() => {
    liveRef.current = live;
    wake.current();
  }, [live]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className={cn('absolute inset-0 transition-opacity duration-700', dots ? 'opacity-100' : 'opacity-0')}>
      <svg className="absolute inset-0 size-full" width="100%" height="100%">
        <defs>
          <pattern id="ambient-dots" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1" fill="rgba(255,255,255,0.055)" />
          </pattern>
          <radialGradient id="ambient-fade" cx="50%" cy="36%" r="68%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <mask id="ambient-mask"><rect width="100%" height="100%" fill="url(#ambient-fade)" /></mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#ambient-dots)" mask="url(#ambient-mask)" />
      </svg>
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      </div>
      <div className="ambient-spot" style={still ? { animationPlayState: 'paused' } : undefined} />
    </div>
  );
}
