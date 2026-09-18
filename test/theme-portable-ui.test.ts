/**
 * UI contract for theme export/import — source assertions over the two surfaces
 * that expose it (the Themes library page and the operator's right inspector).
 *
 * What we lock down: a volunteer is never left guessing. If a picture couldn't
 * come across, they are told in plain English; the card they see is what the
 * SERVER saved (not what the file claimed); and a hostile/huge file is refused
 * client-side before it is shipped to a server action.
 *
 * Run: npx tsx test/theme-portable-ui.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missingMediaMessage } from "../src/lib/theme-portable";

let n = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); n++; };

const manager = readFileSync("src/components/library/ThemesManager.tsx", "utf8");
const inspector = readFileSync("src/components/operator/shell/RightInspector.tsx", "utf8");

for (const [label, src] of [["ThemesManager", manager], ["RightInspector", inspector]] as const) {
  ok(/MAX_THEME_FILE_BYTES/.test(src), `${label}: refuses an oversized file before calling the server`);
  ok(/missingMediaMessage\(/.test(src), `${label}: surfaces missing pictures in plain English`);
  ok(/\.pftheme\.json/.test(src), `${label}: exports with the documented .pftheme.json extension`);
  ok(/unresolvedMedia/.test(src), `${label}: warns when a picture could not be included in the export`);
  ok(/isn't valid theme JSON/.test(src), `${label}: a non-JSON file gets a plain-English error, not a stack trace`);
  ok(!/JSON\.parse\(await (file|f)\.text\(\)\)[\s\S]{0,80}importTheme/.test(src) || /catch/.test(src), `${label}: the parse is guarded`);
}

// The library card must show what the SERVER saved (it is what sanitised the
// values and dropped foreign pictures) — not the untrusted file's own claims.
ok(/const \{ id, name, config, rejectedFields, missingMedia \} = res\.data;/.test(manager), "ThemesManager renders the server's saved name/config");
ok(!/const obj = parsed as \{ name\?: unknown; config\?: unknown \}/.test(manager), "ThemesManager no longer trusts the uploaded file for what to display");

// The messages themselves must be actionable, not jargon.
const msg = missingMediaMessage(["sunrise.jpg"]);
ok(msg.includes("sunrise.jpg"), "the missing picture is named");
ok(/open the theme and choose your own background/.test(msg), "the message says what to do next");
ok(!/s3|presign|churchId|sanitiz/i.test(msg), "no engineering jargon reaches a volunteer");
ok(missingMediaMessage(["a", "b", "c", "d", "e"]).includes("and 2 more"), "a long list is summarised, not dumped");

// The ProPresenter background importer is a SEPARATE, pre-existing flow — this
// work must not have unwired it (rule 0).
ok(/ThemeImportDialog/.test(manager), "the existing ProPresenter background import dialog is still wired into Themes");

console.log(`theme-portable-ui: ${n} assertions passed`);
