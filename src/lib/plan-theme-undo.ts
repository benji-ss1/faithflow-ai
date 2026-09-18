/**
 * Undo for "Apply theme to all items…" (review fix 🟡7). Pure orchestration over
 * injected server calls so it is unit-testable: it NEVER aborts half-way —
 * every item and song is attempted. When an item's previous theme has since
 * been deleted ("Theme not found"), the item is cleared to no theme instead.
 */
type R = { ok: boolean; error?: string };

export async function undoPlanTheme(
  previous: { itemId: string; themeId: string | null }[],
  songs: { songId: string; previousThemeId: string | null }[],
  api: {
    setItemTheme: (itemId: string, themeId: string | null) => Promise<R>;
    applySongTheme: (themeId: string, songId: string) => Promise<R>;
    revertSong: (songId: string) => Promise<R>;
  },
): Promise<{ failed: number; clearedDeleted: number }> {
  let failed = 0, clearedDeleted = 0;
  const safe = async (fn: () => Promise<R>): Promise<R> => {
    try { return await fn(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  };
  for (const p of previous) {
    const r = await safe(() => api.setItemTheme(p.itemId, p.themeId));
    if (r.ok) continue;
    if (p.themeId && r.error === "Theme not found") {
      const c = await safe(() => api.setItemTheme(p.itemId, null));
      if (c.ok) { clearedDeleted++; continue; }
    }
    failed++;
  }
  for (const sg of songs) {
    let r = sg.previousThemeId ? await safe(() => api.applySongTheme(sg.previousThemeId!, sg.songId)) : await safe(() => api.revertSong(sg.songId));
    if (!r.ok && sg.previousThemeId && r.error === "Theme not found") {
      r = await safe(() => api.revertSong(sg.songId));
      if (r.ok) { clearedDeleted++; continue; }
    }
    if (!r.ok) failed++;
  }
  return { failed, clearedDeleted };
}
