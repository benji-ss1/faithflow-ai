/**
 * SELF-HOSTED typefaces. One declaration per family, shared by every layout.
 *
 * WHY (2026-09-22): these were `next/font/google`, which downloads from Google
 * AT BUILD TIME. Three production builds failed in one afternoon with
 *
 *   An error occurred in `next/font`.
 *   TypeError: Cannot read properties of null (reading '1')
 *   at .../@next/font/dist/google/loader.js:122:78
 *
 * That line is `/\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]` —
 * no null check. When Google answers with a URL shape Next does not expect,
 * `.exec` returns null and the build dies with a message naming neither the
 * font nor the cause. Next HAS a proper error for a bad font fetch
 * ("Failed to fetch `X` from Google Fonts"), but this line crashes before it
 * can ever be reached.
 *
 * It was ~25% of our builds, entirely outside our control, and it blocked
 * merges that had nothing to do with fonts. Self-hosting removes the network
 * from the build path: the files are in the repo, so a build either works or
 * fails for a reason we own.
 *
 * WHAT CHANGED VISUALLY: nothing is intended to. Each file is the same latin
 * woff2 Google was already serving, taken as the VARIABLE font where the
 * family has one — so every weight in the ranges below comes from one file
 * rather than one file per weight. `next/font/local` still self-hosts,
 * subsets, and emits the same CSS variables, so consumers are unchanged.
 *
 * TO UPDATE a face, re-run scripts/fonts/fetch-google-fonts.mjs.
 */
import localFont from "next/font/local";

/** Display serif — marketing hero + OpenFlow's greeting. */
export const fraunces = localFont({
  src: [
    { path: "../fonts/Fraunces.woff2", weight: "300 700", style: "normal" },
    { path: "../fonts/Fraunces-Italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--pf-serif",
  display: "swap",
  // Matches what next/font/google picked automatically, so a slow-loading
  // face does not reflow the page differently than it used to.
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const inter = localFont({
  src: [{ path: "../fonts/Inter.woff2", weight: "100 900", style: "normal" }],
  variable: "--of-font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

export const allura = localFont({
  src: [{ path: "../fonts/Allura.woff2", weight: "400", style: "normal" }],
  variable: "--of-font-script",
  display: "swap",
  fallback: ["cursive"],
});

export const jetbrainsMono = localFont({
  src: [
    { path: "../fonts/JetBrainsMono.woff2", weight: "100 800", style: "normal" },
    { path: "../fonts/JetBrainsMono-Italic.woff2", weight: "100 800", style: "italic" },
  ],
  variable: "--pf-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const plusJakartaSans = localFont({
  src: [
    { path: "../fonts/PlusJakartaSans.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/PlusJakartaSans-Italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--pf-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

export const caveat = localFont({
  src: [{ path: "../fonts/Caveat.woff2", weight: "400 700", style: "normal" }],
  variable: "--pf-hand",
  display: "swap",
  fallback: ["cursive"],
});

/** The SAME files under the CSS variable names the OpenFlow panel uses.
 *  next/font/local fixes one variable name per declaration, and these two
 *  families are consumed under different names in the marketing layouts and in
 *  OpenFlow. Declaring them twice costs nothing — it is the same local file,
 *  no network, and Next emits one @font-face per src — whereas renaming the
 *  variables would mean touching openflow.css and site.css, which is a real
 *  chance to break styling for no benefit. */
export const ofSerifFont = localFont({
  src: [
    { path: "../fonts/Fraunces.woff2", weight: "300 700", style: "normal" },
    { path: "../fonts/Fraunces-Italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--of-font-serif",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const ofMonoFont = localFont({
  src: [
    { path: "../fonts/JetBrainsMono.woff2", weight: "100 800", style: "normal" },
    { path: "../fonts/JetBrainsMono-Italic.woff2", weight: "100 800", style: "italic" },
  ],
  variable: "--of-font-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const lora = localFont({
  src: [
    { path: "../fonts/Lora.woff2", weight: "400 700", style: "normal" },
    { path: "../fonts/Lora-Italic.woff2", weight: "400 700", style: "italic" },
  ],
  variable: "--pf-lora",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const cormorantGaramond = localFont({
  src: [
    { path: "../fonts/CormorantGaramond.woff2", weight: "300 700", style: "normal" },
    { path: "../fonts/CormorantGaramond-Italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--pf-cormorant",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});
