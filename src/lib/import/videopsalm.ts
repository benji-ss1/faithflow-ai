// VideoPsalm (.vpagd) importer.
//
// A .vpagd is a ZIP of `Song_N.json` files whose JSON is NOT strict:
//   - keys are bare identifiers:  Author:"…", Text:"…", Verses:[…]
//   - string values may contain RAW newlines (illegal in JSON *and* JSON5)
//   - smart quotes / arbitrary unicode inside strings
// So JSON.parse / JSON5 both reject it. We use a small tolerant recursive-descent
// reader that treats bare identifiers as string keys and allows raw newlines in
// strings. Shape per song:  { Author, Guid, Verses:[{ID?,Text}], Style, Text }
//   - title  = top-level `Text`
//   - artist = `Author`
//   - slides = each `Verses[].Text`  (one verse == one slide)
import { unzipSync, strFromU8 } from "fflate";

export type ParsedSong = { title: string; artist: string | null; slides: string[] };

// ── tolerant relaxed-JSON reader ──────────────────────────────────────────────
class Reader {
  i = 0;
  private depth = 0;
  // ~100x real-world headroom (real songs nest 3-4 deep). Converts a pathological
  // deeply-nested/corrupt file into a controlled throw instead of a stack overflow.
  private static readonly MAX_DEPTH = 500;
  constructor(readonly s: string) {}
  private ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++; }

  value(): unknown {
    this.ws();
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"') return this.string();
    if (c === "-" || (c! >= "0" && c! <= "9")) return this.number();
    return this.bareword();
  }

  private object(): Record<string, unknown> {
    this.depth++;
    try {
      if (this.depth > Reader.MAX_DEPTH) throw new Error("vpagd: nesting too deep");
      const obj: Record<string, unknown> = {};
      this.i++; // consume {
      this.ws();
      if (this.s[this.i] === "}") { this.i++; return obj; }
      for (;;) {
        this.ws();
        const key = this.s[this.i] === '"' ? this.string() : this.identifier();
        this.ws();
        if (this.s[this.i] === ":") this.i++;
        obj[key] = this.value();
        this.ws();
        const ch = this.s[this.i];
        if (ch === ",") { this.i++; continue; }
        if (ch === "}") { this.i++; break; }
        if (this.i >= this.s.length) break;
        this.i++; // tolerate stray chars, keep going
      }
      return obj;
    } finally { this.depth--; }
  }

  private array(): unknown[] {
    this.depth++;
    try {
      if (this.depth > Reader.MAX_DEPTH) throw new Error("vpagd: nesting too deep");
      const arr: unknown[] = [];
      this.i++; // consume [
      this.ws();
      if (this.s[this.i] === "]") { this.i++; return arr; }
      for (;;) {
        arr.push(this.value());
        this.ws();
        const ch = this.s[this.i];
        if (ch === ",") { this.i++; continue; }
        if (ch === "]") { this.i++; break; }
        if (this.i >= this.s.length) break;
        this.i++;
      }
      return arr;
    } finally { this.depth--; }
  }

  private string(): string {
    this.i++; // consume opening "
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++]!;
      if (c === "\\") {
        const e = this.s[this.i++];
        switch (e) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "u": { const hex = this.s.slice(this.i, this.i + 4); this.i += 4; out += String.fromCharCode(parseInt(hex, 16) || 0); break; }
          default: out += e ?? ""; break;
        }
      } else if (c === '"') {
        break; // closing quote
      } else {
        out += c; // raw char, incl. literal newlines/tabs
      }
    }
    return out;
  }

  private identifier(): string {
    let out = "";
    while (this.i < this.s.length && /[A-Za-z0-9_$]/.test(this.s[this.i]!)) out += this.s[this.i++];
    return out;
  }

  private bareword(): unknown {
    const w = this.identifier();
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "null") return null;
    return w; // unknown token → treat as string
  }

  private number(): number {
    let out = "";
    while (this.i < this.s.length && /[0-9eE+\-.]/.test(this.s[this.i]!)) out += this.s[this.i++];
    return Number(out);
  }
}

export function parseRelaxedJson(text: string): unknown {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  return new Reader(t).value();
}

// ── song extraction ───────────────────────────────────────────────────────────
export function extractSong(obj: unknown): ParsedSong | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const title = typeof o.Text === "string" ? o.Text.trim() : "";
  const artist = typeof o.Author === "string" && o.Author.trim() ? o.Author.trim() : null;
  const versesRaw = Array.isArray(o.Verses) ? o.Verses : [];
  const slides = versesRaw
    .map((v) => (v && typeof v === "object" && typeof (v as Record<string, unknown>).Text === "string"
      ? ((v as Record<string, unknown>).Text as string).trim()
      : ""))
    .filter((s) => s.length > 0);
  if (!title && slides.length === 0) return null;
  return { title: title || "Untitled song", artist, slides };
}

function songIndex(name: string): number {
  const m = name.match(/Song_(\d+)\.json/i);
  return m ? parseInt(m[1]!, 10) : 0;
}

// Unzip a .vpagd and return one ParsedSong per Song_N.json (in numeric order).
// A corrupt individual entry is skipped, never aborting the whole import.
export function parseVpagd(bytes: Uint8Array): ParsedSong[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /(^|\/)Song_\d+\.json$/i.test(f.name) });
  } catch {
    return []; // not a valid zip / corrupt .vpagd → "no songs found", never throws to the UI
  }
  const names = Object.keys(files).sort((a, b) => songIndex(a) - songIndex(b));
  const out: ParsedSong[] = [];
  for (const name of names) {
    try {
      const song = extractSong(parseRelaxedJson(strFromU8(files[name]!)));
      if (song) out.push(song);
    } catch { /* skip a corrupt song, keep the rest */ }
  }
  return out;
}
