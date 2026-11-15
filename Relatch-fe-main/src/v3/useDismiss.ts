// Closes a small popover on a press outside it, or on Escape.
import { useEffect, type RefObject } from 'react';

export function useDismiss(box: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    // A press inside a pop-up opened from the box (Modal, rendered elsewhere in the page) is not "outside".
    const away = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node) || (e.target as Element | null)?.closest?.('[data-modal]')) return;
      close();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
