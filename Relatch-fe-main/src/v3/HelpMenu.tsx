// Where an app keeps what a site would put in a footer: one quiet button in the corner. It holds the
// note on how a document is handled, the legal links and the way to reach us, on every screen, so
// neither the intro nor the workspace needs a bar along the bottom.
//
// The note says only what the privacy policy (LegalPage.tsx, 2.4, 2.6 and "Data Retention") says:
// documents go to the AI providers to write the skill and are not kept beyond what delivering it needs,
// and skills are kept only for a signed-in account. Keep the two in step if either changes.
//
// The policy and the terms open as pages of the app (LegalPage.tsx), not the landing's pages, which
// wear the old design.
import { useLayoutEffect, useRef, useState } from 'react';
import { useDismiss } from './useDismiss';
import { HelpGlyph } from './HelpGlyph';
import { cn } from '@/lib/utils';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const item = 'flex items-center rounded-lg px-3 py-2 text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60';

export function HelpMenu({ onOpen }: { onOpen: (page: 'contact' | 'privacy' | 'terms') => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const leaving = useRef<Animation | null>(null);

  // Grows out of the "?" button itself: it starts as a small blurred shape on the button and scales up
  // from the button's centre into place, fast. Its three parts then rise in one after another.
  // (A first version widened it sideways, like the drop zone under the hero; it read as sliding in.)
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el || calm()) return;
    // One continuous ease-out: most of the growth lands in the first ~150ms (fast), the rest settles.
    el.animate([
      { opacity: 0, transform: 'scale(0.15)', filter: 'blur(8px)' },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
    ], { duration: 380, easing: OUT });
    Array.from(el.children).forEach((c, i) => (c as HTMLElement).animate([
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'translateY(0px)' },
    ], { duration: 280, easing: OUT, delay: 90 + i * 40, fill: 'backwards' }));
  }, [open]);

  // Closing shrinks it back into the button before it leaves the page.
  const close = () => {
    const el = panel.current;
    if (!el || calm()) { setOpen(false); return; }
    if (leaving.current) return;
    leaving.current = el.animate([
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
      { opacity: 0, transform: 'scale(0.1)', filter: 'blur(6px)' },
    ], { duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
    leaving.current.onfinish = () => { leaving.current = null; setOpen(false); };
  };
  // Pressed again while it is closing: it stays open.
  const toggle = () => {
    if (leaving.current) { leaving.current.cancel(); leaving.current = null; return; }
    if (open) close(); else setOpen(true);
  };
  useDismiss(box, open, close);

  return (
    <div ref={box} className="fixed z-40" style={{ right: 'max(16px, env(safe-area-inset-right, 0px))', bottom: 'max(16px, env(safe-area-inset-bottom, 0px))' }}>
      {open && (
        // Scaled from the button's centre: 18px in from the panel's right edge, and 8px gap + 18px below
        // its bottom edge.
        <div ref={panel} id="help-menu" className="absolute bottom-full right-0 mb-2 w-[288px] origin-[calc(100%-18px)_calc(100%+26px)] rounded-2xl border border-line-2 bg-ink-2/95 p-2 text-[13.5px] shadow-[0_24px_60px_rgb(0_0_0/0.6)] backdrop-blur-xl">
          <div className="px-3 pb-3 pt-2">
            <p className="text-[13px] font-medium text-fg">How your documents are handled</p>
            <p className="mt-1.5 text-[12.5px] leading-[1.55] text-fg-2">
              Relatch sends your document's text to its AI providers only to write your skill. Scanned files are read with OCR first. Documents aren't kept beyond what's needed to deliver the skill. Skills you make while signed in are saved to your account; the free try isn't kept.
            </p>
          </div>
          <div className="border-t border-line pt-1.5">
            {/* The Contact page, not a mailto: link (ContactPage.tsx says why). */}
            {([['contact', 'Contact support'], ['privacy', 'Privacy policy'], ['terms', 'Terms of service']] as const).map(([p, text]) => (
              <button key={p} type="button" onClick={() => { setOpen(false); onOpen(p); }} className={`${item} w-full text-left`}>{text}</button>
            ))}
          </div>
          <p className="px-3 pb-1.5 pt-2 text-[11.5px] text-fg-3">© {new Date().getFullYear()} Relatch</p>
        </div>
      )}
      <button
        type="button"
        aria-label="Help, privacy and terms"
        aria-expanded={open}
        aria-controls="help-menu"
        onClick={toggle}
        className={cn('grid size-9 place-items-center rounded-full border bg-ink-2/80 backdrop-blur-xl transition-[color,border-color,transform] duration-200 hover:border-line-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60 active:scale-[0.94]', open ? 'border-line-2 text-fg' : 'border-line text-fg-2')}
      >
        {/* Every 15s the "?" turns into bot eyes for ~3s (HelpGlyph.tsx), held still while the menu is open. */}
        <HelpGlyph paused={open} />
      </button>
    </div>
  );
}
