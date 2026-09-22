// Download the exact font files our next/font/google declarations need, so the
// build stops depending on Google being reachable.
import { writeFileSync, mkdirSync } from "node:fs";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OUT = "src/fonts";
mkdirSync(OUT, { recursive: true });

// family -> the css2 query we need. Variable ranges where the family has one.
const WANT = [
  ["Fraunces",          "Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700"],
  ["Inter",             "Inter:wght@100..900"],
  ["Allura",            "Allura"],
  ["JetBrainsMono",     "JetBrains+Mono:ital,wght@0,100..800;1,100..800"],
  ["PlusJakartaSans",   "Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800"],
  ["Caveat",            "Caveat:wght@400..700"],
  ["Lora",              "Lora:ital,wght@0,400..700;1,400..700"],
  ["CormorantGaramond", "Cormorant+Garamond:ital,wght@0,300..700;1,300..700"],
];

const manifest = [];
for (const [name, q] of WANT) {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, { headers: { "User-Agent": UA } }).then(r => r.text());
  if (css.includes("<!DOCTYPE") || !css.includes("@font-face")) { console.error(`!! ${name}: bad CSS`); process.exit(1); }
  // Take the latin (not latin-ext) block per style.
  const faces = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*@font-face \{([^}]*)\}/g)];
  const picked = new Map();
  for (const [, subset, body] of faces) {
    if (subset !== "latin") continue;
    const style = /font-style:\s*italic/.test(body) ? "italic" : "normal";
    const url = body.match(/url\((https:[^)]*\.woff2)\)/)?.[1];
    if (url && !picked.has(style)) picked.set(style, url);
  }
  if (picked.size === 0) { console.error(`!! ${name}: no latin woff2`); process.exit(1); }
  for (const [style, url] of picked) {
    const file = `${name}${style === "italic" ? "-Italic" : ""}.woff2`;
    const buf = Buffer.from(await fetch(url).then(r => r.arrayBuffer()));
    writeFileSync(`${OUT}/${file}`, buf);
    manifest.push({ name, style, file, bytes: buf.length });
    console.log(`${file}  ${(buf.length/1024).toFixed(0)}KB`);
  }
}
writeFileSync("/tmp/font-manifest.json", JSON.stringify(manifest, null, 2));
