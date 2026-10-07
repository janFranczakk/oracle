import { useEffect } from 'react';

export function useDialogFocus(activeDialog: string | null, close: () => void) {
  useEffect(() => {
    if (!activeDialog) return;
    const active = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () => document.querySelector<HTMLElement>('.modal button, .modal input')?.focus(),
      0,
    );
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.modal button:not(:disabled), .modal input, .modal a',
          ),
        );
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keys);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', keys);
      active?.focus();
    };
  }, [activeDialog, close]);
}
