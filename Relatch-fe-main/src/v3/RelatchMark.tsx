// The Relatch mark, alive. Four latch pieces around a square centre:
//   idle      - a slow breath, the pieces barely part
//   thinking  - the pieces part, the mark turns a quarter, the pieces close; repeat
//                (the product's own "reasoning" animation, the way Claude's spark turns)
//   done      - the pieces latch shut with one firm settle
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { MARK_PIECES } from './markPieces';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP);

export type MarkState = 'idle' | 'thinking' | 'done';

// `still` holds the pieces shut whatever the state (the header mark: only its glow follows the job).
// `glow={false}` drops the thinking halo: at list-row size it swamps the mark and reads as a glitch.
export function RelatchMark({ state = 'idle', size = 40, className, still = false, glow = true }: { state?: MarkState; size?: number; className?: string; still?: boolean; glow?: boolean }) {
  const root = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      const svg = root.current;
      if (!svg) return;
      const group = svg.querySelector('[data-mark]') as SVGGElement;
      const pieces = Array.from(svg.querySelectorAll<SVGGElement>('[data-piece]'));
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const spread = (d: number) => (i: number) => ({ x: MARK_PIECES[i].dx * d, y: MARK_PIECES[i].dy * d });

      if (reduce || still) {
        gsap.set(pieces, { x: 0, y: 0 });
        return;
      }

      if (state === 'idle') {
        gsap.to(pieces, { x: (i) => spread(1.4)(i).x, y: (i) => spread(1.4)(i).y, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        return;
      }

      if (state === 'thinking') {
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.15 });
        tl.to(pieces, { x: (i) => spread(7)(i).x, y: (i) => spread(7)(i).y, duration: 0.45, ease: 'power2.out' })
          .to(group, { rotation: '+=90', svgOrigin: '50 50', duration: 0.75, ease: 'power3.inOut' }, '-=0.1')
          .to(pieces, { x: 0, y: 0, duration: 0.4, ease: 'power2.in' }, '-=0.2')
          .to({}, { duration: 0.25 });
        return;
      }

      // done: close the latch and settle once on the nearest quarter turn
      const r = Number(gsap.getProperty(group, 'rotation')) || 0;
      gsap.to(group, { rotation: Math.round(r / 90) * 90, svgOrigin: '50 50', duration: 0.35, ease: 'power2.out' });
      gsap.fromTo(pieces, { x: (i) => spread(5)(i).x, y: (i) => spread(5)(i).y }, { x: 0, y: 0, duration: 0.42, ease: 'back.out(2.2)' });
    },
    { scope: root, dependencies: [state, still], revertOnUpdate: true },
  );

  return (
    <svg
      ref={root}
      viewBox="-12 -12 124 124"
      width={size}
      height={size}
      role="img"
      aria-label={state === 'thinking' ? 'Relatch is thinking' : 'Relatch'}
      className={cn('shrink-0 overflow-visible transition-[filter] duration-700', state === 'thinking' && glow && 'drop-shadow-[0_0_14px_rgba(255,255,255,0.35)]', className)}
    >
      <g data-mark>
        {MARK_PIECES.map((p) => (
          <g key={p.id} data-piece>
            <path d={p.d} fill="currentColor" />
          </g>
        ))}
      </g>
    </svg>
  );
}
