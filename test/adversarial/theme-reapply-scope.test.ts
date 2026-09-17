/**
 * Theme Editor PR 1 — tenant scoping of the new theme re-apply actions.
 * song_slides has NO church_id, so every slide write must be filtered by the
 * song_id of a church-verified song. Source assertions (no DB needed).
 *
 * Run: npx tsx test/adversarial/theme-reapply-scope.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/actions.ts", "utf8");
function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = src.indexOf("\nexport async function ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}
let n = 0;
const ok = (cond: boolean | RegExpMatchArray | null, msg: string) => { assert.ok(cond, msg); n++; };

for (const name of ["countSongsUsingTheme", "reapplyThemeToSongs", "applyThemeToSong", "applyThemeToSongSlide", "updateTheme"]) {
  const b = body(name);
  ok(b.match(/requireCap\("edit_library"\)/), `${name} requires edit_library`);
  ok(b.match(/eq\(themes\.id, themeId|eq\(themes\.id, id\)/) ? /eq\(themes\.churchId, user\.churchId\)/.test(b) : true, `${name} selects the theme by church`);
}

const re = body("reapplyThemeToSongs");
ok(/eq\(themes\.id, themeId\), eq\(themes\.churchId, user\.churchId\)/.test(re), "reapply re-selects the theme by church");
ok(/songsUsingThemeWhere\(user\.churchId, themeId\)/.test(re), "reapply song page is church-filtered");
ok(/eq\(songs\.id, songId\), eq\(songs\.churchId, user\.churchId\)\)\)\.for\("update"\)/.test(re), "each song re-checked by church + row-locked");
ok(/db\.transaction\(/.test(re), "per-song transaction");
ok(/from\(songSlides\)\.where\(eq\(songSlides\.songId, songId\)\)/.test(re), "slides read by church-verified song_id");
ok(/tx\.update\(songSlides\)[\s\S]*?\.where\(and\(eq\(songSlides\.id, sl\.id\), eq\(songSlides\.songId, songId\)\)\)/.test(re), "slide UPDATE filtered by song_id");
ok(!/db\.update\(songSlides\)/.test(re), "no slide write outside the locked transaction");
ok(/tx\.update\(songs\)[\s\S]*?eq\(songs\.churchId, user\.churchId\)/.test(re), "song settings write church-filtered");

const where = src.slice(src.indexOf("function songsUsingThemeWhere("), src.indexOf("export async function countSongsUsingTheme("));
ok(/eq\(songs\.churchId, churchId\)/.test(where), "shared song filter includes church_id");

const count = body("countSongsUsingTheme");
ok(/songsUsingThemeWhere\(user\.churchId, themeId\)/.test(count), "count is church-filtered");

const apply = body("applyThemeToSong");
ok(/eq\(songSlides\.id, s\.id\), eq\(songSlides\.songId, songId\)/.test(apply), "whole-song apply slide UPDATE filtered by song_id");
ok(/mergeThemeBackup\(prevSettings\.themeBackup/.test(apply), "whole-song apply preserves the first backup");
ok(/bakeThemeIntoObjectsJson\(cfg, s\.objectsJson\)/.test(apply), "whole-song apply uses the shared bake");

console.log(`theme-reapply-scope: all ${n} assertions passed`);
