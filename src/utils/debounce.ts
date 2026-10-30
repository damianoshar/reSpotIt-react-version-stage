import { useState, useEffect } from 'react';

/** Shared debounce hook — avoids duplicating this logic in every hook file. */
export function useDebounce<T>(value: T, delay: number): T {
  const [d, setD] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

/** Shared helper used by DB query functions. */
export function yearStr(val: number | ''): string {
  return val === '' ? '' : String(val);
}
