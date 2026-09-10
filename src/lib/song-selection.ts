/**
 * "Open this song in the Songs library" signal.
 *
 * The Songs library center panel (`SongsBrowser`) is conditionally mounted, so a
 * listener living inside it isn't registered yet when the Cmd+K search palette
 * fires its synchronous "open song" event while switching INTO songs mode — the
 * event lands on nobody. (That mount race is exactly why an earlier in-panel
 * approach failed while the Bible path worked.)
 *
 * So this mirrors the proven Bible pattern: the ALWAYS-mounted ProOperatorShell
 * listens for this event, stores the pick in shell state, and passes it down to
 * SongsBrowser as a prop. No module singleton, no consume-once race, no leak.
 */
export type SongSelection = { id: string; title: string; artist: string | null };

export const SONG_OPEN_EVENT = "presentflow:song-open";

export function requestSongOpen(sel: SongSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<SongSelection>(SONG_OPEN_EVENT, { detail: sel }));
  } catch { /* noop */ }
}
