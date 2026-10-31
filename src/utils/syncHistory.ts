// ---------------------------------------------------------------------------
// Sync-history helpers — pure, so the modal keeps one definition of "which
// rows of GET /api/v1/sync/history are recent syncs, and how do we word them".
//
// The endpoint is canonical (elixir, C# and python all serve it): {data: [job
// envelope]} listing EVERY job type, newest first. This tree's envelope type
// lives in services/remote/libraryRemote.ts; HistoryJob below is the structural
// subset this module needs, so utils/ stays import-free.
// ---------------------------------------------------------------------------

/** The parts of a job envelope the history line reads. All backends send these;
 *  created_at/finished_at are optional extras (python adds them, elixir and C#
 *  do not), so nothing here may require them. */
export interface HistoryJob {
  job_id?: string;
  type: string;
  status: string;
  result?: { imported?: number; existing?: number } | null;
  error?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
}

const TERMINAL = ['done', 'error', 'cancelled'];

export function isTerminal(status: string | undefined | null): boolean {
  return TERMINAL.includes(String(status));
}

/**
 * The last few FINISHED library syncs, newest first (server order kept).
 *
 * History lists queue and playlist jobs too, which are not "recent syncs", and
 * a still-running job is not a finished run — both are filtered out rather than
 * rendered as if they had an outcome.
 */
export function recentSyncs(items: unknown, max = 3): HistoryJob[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((j): j is HistoryJob => !!j && isTerminal(j.status) && j.type === 'sync')
    .slice(0, max);
}

/** "12 added, 3 updated" for a finished run, or why it did not finish. */
export function syncOutcome(job: HistoryJob): string {
  if (job.status === 'error') return job.error || 'Sync failed';
  if (job.status === 'cancelled') return 'Cancelled';
  const r = job.result;
  return `${r?.imported ?? 0} added, ${r?.existing ?? 0} updated`;
}

/**
 * "4 min ago" style age for a history timestamp; '' when absent or unparseable.
 *
 * A missing stamp must render as no age at all — '' rather than an invented
 * date. `now` is injectable so callers can pin boundaries.
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';

  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return 'just now';

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`;

  return new Date(t).toLocaleDateString();
}
