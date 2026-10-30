import { useState, useCallback } from 'react';

export interface Toast { id: number; msg: string; ok: boolean; }

let nextId = 0;

/** Stacked toasts (max 3) — a new message no longer swallows the previous one. */
export function useToast(durationMs = 3500) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((msg: string, ok = true) => {
    const id = ++nextId;
    setToasts((prev) => [...prev.slice(-2), { id, msg, ok }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), durationMs);
  }, [durationMs]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, show, dismiss };
}
