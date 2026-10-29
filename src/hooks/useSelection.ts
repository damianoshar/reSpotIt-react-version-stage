import { useState, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';

// useSelection is generic so it works for both Album and PlaylistAlbum
export function useSelection<T extends { id: string }>(albums: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // toggle is stable forever — uses functional updater so no dep on `selected`.
  // flushSync forces the committed state + DOM to update before this handler
  // returns, so the selected border/checkmark show immediately instead of
  // waiting for the next render/interaction.
  const toggle = useCallback((id: string) => {
    flushSync(() => {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === albums.length
        ? new Set()
        : new Set(albums.map((a) => a.id))
    );
  }, [albums]);

  // Only recompute when selected Set identity or albums array changes
  const selectedAlbums = useMemo(
    () => albums.filter((a) => selected.has(a.id)),
    [albums, selected]
  );

  const allSelected = albums.length > 0 && selected.size === albums.length;

  return { selected, selectedAlbums, allSelected, toggle, clear, toggleAll };
}
