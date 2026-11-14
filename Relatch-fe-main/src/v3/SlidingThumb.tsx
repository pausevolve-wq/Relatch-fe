// The thumb that slides behind the selected option of a pill of choices: the hero's Claude/Codex switch,
// the sidebar's small pills (and, until 2026-11-03, the API page's language tabs). Drop it in as the first child of a
// `relative` radiogroup whose options are role="radio" buttons carrying aria-checked.
//
// It is measured, not assumed: the labels are different widths, and the font can still swap in after
// mount. While it slides it gets a horizontal-only motion blur whose strength follows how fast it is
// really moving, read from its position each frame, so the blur swells as it takes off, clears as it
// lands, and stays right when a slide is interrupted by another tap. Only the thumb is filtered: the
// labels sit above it and stay sharp.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// px of horizontal blur per px/ms of speed, and its ceiling.
const SMEAR = 8;
const SMEAR_MAX = 6.5;
const GLIDE = 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1), width 500ms cubic-bezier(0.16, 1, 0.3, 1)';

// `onGlide` runs as a slide starts, with the newly selected option (the hero switch blurs its label in).
// `onArrive` runs once the thumb has actually reached it (its centre within 3px of the option's, read each
// frame), so an option's own animation can start when the white thumb gets there (Manas, 2026-11-10).
// A slide interrupted by another pick never arrives; with reduced motion there is no slide, so it runs at once.
export function SlidingThumb({ value, className, onGlide, onArrive }: { value: string; className?: string; onGlide?: (selected: HTMLElement) => void; onArrive?: (selected: HTMLElement) => void }) {
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const clip = useRef<HTMLSpanElement>(null);
  const thumbEl = useRef<HTMLSpanElement>(null);
  const smearEl = useRef<SVGFEGaussianBlurElement>(null);
  const smearId = `thumb-smear-${useId().replace(/[^a-z0-9]/gi, '')}`;
  const raf = useRef(0);
  const shown = useRef(value);
  const [thumb, setThumb] = useState<{ x: number; w: number; glide: boolean } | null>(null);

  const place = (glide: boolean) => {
    const b = clip.current?.parentElement?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!b) return null;
    const x = b.offsetLeft;
    const w = b.offsetWidth;
    setThumb((t) => (t && t.x === x && t.w === w && t.glide === glide ? t : { x, w, glide }));
    return b;
  };

  const smear = (target: HTMLElement) => {
    const el = thumbEl.current;
    const fe = smearEl.current;
    if (!el || !fe) { arrive.current?.(target); return; }
    cancelAnimationFrame(raf.current);
    const centre = () => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
    const goal = () => { const r = target.getBoundingClientRect(); return r.left + r.width / 2; };
    const began = performance.now();
    let x = centre();
    let t = began;
    let amount = 0;
    let arrived = false;
    el.style.filter = `url(#${smearId})`;
    const tick = (now: number) => {
      const nx = centre();
      const speed = Math.abs(nx - x) / Math.max(now - t, 1); // px per ms
      x = nx;
      t = now;
      if (!arrived && Math.abs(nx - goal()) < 3) { arrived = true; arrive.current?.(target); }
      amount += (Math.min(speed * SMEAR, SMEAR_MAX) - amount) * 0.3; // eased, so it never snaps on or off
      if (now - began > 160 && speed < 0.01 && amount < 0.08) { // landed: hand the thumb back unfiltered
        el.style.filter = '';
        fe.setAttribute('stdDeviation', '0 0');
        if (!arrived) arrive.current?.(target); // stopped short of the 3px window (a resize mid-slide)
        return;
      }
      fe.setAttribute('stdDeviation', `${amount.toFixed(2)} 0`);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useLayoutEffect(() => {
    const changed = shown.current !== value;
    shown.current = value;
    const b = place(changed);
    if (b && changed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onGlide?.(b);
      smear(b);
    } else if (b && changed) arrive.current?.(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => {
    const group = clip.current?.parentElement;
    if (!group) return;
    // Also re-measures when a hidden group (a closed sidebar) is shown again.
    const ro = new ResizeObserver(() => place(false));
    ro.observe(group);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <filter id={smearId} x="-30%" y="0" width="160%" height="100%" colorInterpolationFilters="sRGB">
          <feGaussianBlur ref={smearEl} in="SourceGraphic" stdDeviation="0 0" />
        </filter>
      </svg>
      {/* Clips the thumb to the pill, so the blur never spills past the control's own edge. */}
      <span ref={clip} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        <span
          ref={thumbEl}
          className={cn('absolute left-0 rounded-full will-change-transform', className)}
          style={thumb ? { width: thumb.w, transform: `translateX(${thumb.x}px)`, transition: thumb.glide ? GLIDE : 'none' } : { opacity: 0 }}
        />
      </span>
    </>
  );
}

// A small pill of choices with the sliding thumb: the skills filter, the default agent, (until 2026-11-03) the API page's
// language tabs. The labels only change colour; the thumb under them carries the motion.
// `size="md"`: the same control at the size of page tabs (it was the API platform's sections and periods; removed 2026-11-03).
export function Segmented<T extends string>({ label, value, options, onChange, size = 'sm' }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  const md = size === 'md';
  return (
    <div role="radiogroup" aria-label={label} className={cn('relative inline-flex shrink-0 rounded-full border border-line bg-white/[0.03]', md ? 'p-1' : 'p-0.5')}>
      <SlidingThumb value={value} className={cn(md ? 'inset-y-1' : 'inset-y-0.5', 'bg-white/[0.13]')} />
      {options.map(([v, text]) => (
        // type="button": inside a form (as in the API key dialog, removed 2026-11-03) a plain button would submit it.
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn('relative z-[1] rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-white/60', md ? 'h-8 px-4 text-[13.5px] font-medium' : 'h-6 px-2.5 text-[12px]', value === v ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}>{text}</button>
      ))}
    </div>
  );
}
