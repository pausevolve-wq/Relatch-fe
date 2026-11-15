// A pop-up centred over a dimmed page, for the dialogs opened from the sidebar and the API page (clear
// history, your account, a new API key). Rendered into <body>: the sidebar's backdrop blur makes it the
// containing block for anything `fixed` inside it, which would trap the pop-up inside the rail.
// `className` styles the panel; the account pop-up leaves it bare because Clerk draws its own card.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export function Modal({ label, onClose, className, role = 'dialog', children }: { label: string; onClose: () => void; className?: string; role?: 'dialog' | 'alertdialog'; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Caught on the way down and stopped there, so Escape closes this pop-up and not the panel under it.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.parentElement?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    el.animate([{ opacity: 0, transform: 'translateY(8px) scale(0.97)' }, { opacity: 1, transform: 'translateY(0px) scale(1)' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }, []);

  return createPortal(
    <div data-modal className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto scroll-thin bg-black/70 p-4 backdrop-blur-md" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role={role} aria-modal="true" aria-label={label} className={cn('relative w-full', className)}>{children}</div>
    </div>,
    document.body,
  );
}
