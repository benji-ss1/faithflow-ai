/*
 * OpenFlow typefaces. SELF-HOSTED — the actual files live in src/fonts and the
 * declarations in src/lib/fonts.ts, so the build no longer fetches anything
 * from Google (see the note at the top of that file: three production builds
 * failed in one afternoon inside next/font's Google loader).
 *
 *   Display  — Fraunces   (soft optical serif; the greeting's soul)
 *   Wordmark — Allura     (flowing signature script for "Flow")
 *   UI       — Inter      (the spec's working face; tabular numerics)
 *   Data     — JetBrains Mono (eyebrows, timers, durations)
 *
 * Each still exposes the SAME CSS variable openflow.css already reads through
 * --of-font-*, so nothing downstream changes.
 */
import { ofSerifFont, allura, inter, ofMonoFont } from "@/lib/fonts";

export const ofSerif = ofSerifFont;
export const ofScript = allura;
export const ofSans = inter;
export const ofMono = ofMonoFont;

/** The combined font-variable classNames to spread onto the OpenFlow root. */
export const openFlowFontVars = [
  ofSerif.variable,
  ofScript.variable,
  ofSans.variable,
  ofMono.variable,
].join(" ");
