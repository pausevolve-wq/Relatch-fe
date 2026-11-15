// The first-load hero choreography. The headline blur-reveals large at the centre of the screen, holds,
// then shrinks into its place; the Claude/Codex switch and the drop zone emerge downward out of it just
// before it lands, and the supporting copy fades up last. Any press skips straight to the settled page.
//
// Web Animations API on purpose (no GSAP here): it runs off the main thread, and an animation that is
// cancelled hands the element back to its own CSS, so nothing has to be cleaned up by hand afterwards.
// The headline's word-by-word stagger is SplitText's own; onStart releases it on the same frame.
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN_OUT = 'cubic-bezier(0.87, 0, 0.13, 1)';

// Once per page load: coming back to Start after a job does not replay it.
let played = false;

export function introPending() {
  return !played && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface IntroParts {
  hero: HTMLElement;
  pill: HTMLElement;
  drop: HTMLElement;
  fades: HTMLElement[];
  onStart: () => void;
}

// Call from a layout effect: the pre-state has to be in place before the first paint. Returns teardown.
export function runHeroIntro({ hero, pill, drop, fades, onStart }: IntroParts): () => void {
  if (!introPending()) return () => {};

  const stage = [hero, pill, drop];
  const anims: Animation[] = [];
  const timers: number[] = [];
  let started = false;
  let over = false;

  const at = (ms: number, fn: () => void) => { timers.push(window.setTimeout(() => { if (!over) fn(); }, ms)); };
  const tween = (el: HTMLElement, frames: Keyframe[], duration: number, easing = OUT, delay = 0) => {
    anims.push(el.animate(frames, { duration, easing, delay, fill: 'forwards' }));
  };
  const start = () => { if (!started) { started = true; onStart(); } };
  const end = () => {
    if (over) return;
    over = true;
    timers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener('pointerdown', skip);
    anims.forEach((a) => a.cancel());
    stage.forEach((el) => { el.style.visibility = ''; el.style.opacity = ''; });
    fades.forEach((el) => { el.style.opacity = ''; });
  };
  const finish = () => { played = true; start(); end(); };
  function skip() { finish(); }

  // Pre-state. Hidden, not removed: the headline is measured in its real, final layout.
  stage.forEach((el) => { el.style.visibility = 'hidden'; });
  fades.forEach((el) => { el.style.opacity = '0'; });
  window.addEventListener('pointerdown', skip, { once: true });

  const play = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = hero.getBoundingClientRect();
    const dx = vw / 2 - (r.left + r.width / 2);
    const dy = vh / 2 - (r.top + r.height / 2);
    // A cinematic zoom on desktop, clamped so the headline never outgrows a narrow screen.
    const zoom = Math.min(1.45, Math.max(1, (vw * 0.94) / r.width));
    const pace = vw < 640 ? 0.85 : 1; // slightly snappier on phones
    const D = (ms: number) => Math.round(ms * pace);
    const big = `translate(${dx}px, ${dy}px) scale(${zoom})`;

    pill.style.opacity = '0';
    drop.style.opacity = '0';
    stage.forEach((el) => { el.style.visibility = ''; });
    start();

    // 1. big centred blur reveal
    tween(hero, [
      { opacity: 0, transform: big, filter: 'blur(28px)' },
      { opacity: 1, transform: big, filter: 'blur(0px)' },
    ], D(1150));

    // 2. after a short hold, shrink into place
    const land = D(1150) + D(300);
    at(land, () => tween(hero, [
      { opacity: 1, transform: big, filter: 'blur(0px)' },
      { opacity: 1, transform: 'translate(0px, 0px) scale(1)', filter: 'blur(0px)' },
    ], D(950), IN_OUT));

    // 3. the switch and the drop zone emerge downward out of the headline, just before it lands
    const emerge = (el: HTMLElement, from: number, duration: number) => {
      el.style.opacity = '';
      tween(el, [
        { opacity: 0, transform: `translateY(${from}px) scaleX(0.22)`, filter: 'blur(12px)' },
        { opacity: 1, transform: 'translateY(0px) scaleX(1)', filter: 'blur(0px)' },
      ], duration);
    };
    at(land + D(750), () => emerge(pill, -34, D(800)));
    at(land + D(870), () => emerge(drop, -58, D(850)));

    // 4. supporting copy fades up as the headline lands
    at(land + D(1000), () => fades.forEach((el, i) => tween(el, [
      { opacity: 0, transform: 'translateY(14px)' },
      { opacity: 1, transform: 'translateY(0px)' },
    ], D(700), OUT, Math.round(i * 90 * pace))));

    at(land + D(950) + D(950), finish);
  };

  // Measure only once the faces the hero is set in are really there, or the layout shifts mid-flight.
  const faces = ['700 72px Satoshi', '500 18px Satoshi', '400 18px Satoshi'].map((f) => document.fonts.load(f));
  const cap = new Promise<void>((resolve) => { timers.push(window.setTimeout(resolve, 2500)); });
  Promise.race([Promise.all(faces).then(() => document.fonts.ready), cap]).then(() => { if (!over) play(); }, () => { if (!over) play(); });

  return end;
}
