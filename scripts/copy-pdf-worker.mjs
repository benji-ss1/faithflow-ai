/**
 * Copy the pdf.js worker into public/ so the browser can load it from a stable
 * same-origin path (/pdf.worker.min.js) — used by src/lib/pdf-to-images.ts
 * (PDF deck import, B2). Runs before dev/build so it stays in sync with the
 * installed pdfjs-dist version. Bundler-agnostic and offline-safe (no CDN).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Copy to a .js extension (NOT .mjs): Next serves .js from public/ as
// text/javascript reliably, whereas .mjs is served with a MIME that — combined
// with the global `X-Content-Type-Options: nosniff` header — makes the module
// worker refuse to load. Content is unchanged; the module worker is chosen by
// pdf.js from the ESM main lib, not the file extension.
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const destDir = join(root, "public");
const dest = join(destDir, "pdf.worker.min.js");

if (!existsSync(src)) {
  console.warn(`[copy-pdf-worker] source not found: ${src} — is pdfjs-dist installed? Skipping.`);
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-pdf-worker] copied → public/pdf.worker.min.js`);
