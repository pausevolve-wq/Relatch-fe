// Opening a foldable (a Galaxy Z Fold going from its narrow cover screen to the inner one) makes the
// window about twice as wide while its height barely changes. A phone turning sideways swaps width and
// height instead, and a desktop window dragged wider grows a little at a time, so neither looks like this.
// When it happens, the app opens out from the cover screen's width, from the middle, the way the device
// itself opens, with a soft light running out from the fold line. Skipped with reduced motion.
//
// Only clip-path is animated on #root: a transform or a filter there would make it the containing block
// of every fixed element (sidebar, dialogs) and shift them for the length of the animation.
import { useEffect } from 'react';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MS = 760;

export function useUnfold() {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    let last = { w: window.innerWidth, h: window.innerHeight };
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const from = last.w;
      const unfolded = from < 480 && w >= from * 1.6 && Math.abs(h - last.h) <= last.h * 0.25;
      last = { w, h };
      if (!unfolded || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      // The visible strip starts as wide as the cover screen was, centred, and opens to the full width.
      const side = `${Math.round((w - from) / 2)}px`;
      root.animate([
        { clipPath: `inset(0px ${side} round 28px)` },
        { clipPath: 'inset(0px 0px round 0px)' },
      ], { duration: MS, easing: OUT });
      // The fold line: a thin light at the centre that spreads out and fades as the sides arrive.
      const seam = document.createElement('div');
      seam.setAttribute('aria-hidden', 'true');
      seam.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:200;background:linear-gradient(90deg,transparent 0%,rgb(255 255 255/0.08) 46%,rgb(255 255 255/0.32) 50%,rgb(255 255 255/0.08) 54%,transparent 100%)';
      document.body.appendChild(seam);
      seam.animate([
        { opacity: 1, transform: 'scaleX(0.05)' },
        { opacity: 0, transform: 'scaleX(1)' },
      ], { duration: MS, easing: OUT }).finished.finally(() => seam.remove());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
}
