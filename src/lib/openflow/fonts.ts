/*
 * OpenFlow typefaces, loaded via next/font (self-hosted, no external CDN — so
 * nothing silently falls back). Each exposes a CSS variable that openflow.css
 * reads through --of-font-*. Apply the combined .variable classNames to the
 * OpenFlow panel root alongside .openflow-scope.
 *
 *   Display  — Fraunces   (soft optical serif; the greeting's soul)
 *   Wordmark — Allura     (flowing signature script for "Flow")
 *   UI       — Inter       (the spec's working face; tabular numerics)
 *   Data     — JetBrains Mono (eyebrows, timers, durations)
 */
import { Fraunces, Allura, Inter, JetBrains_Mono } from "next/font/google";

export const ofSerif = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--of-font-serif",
  display: "swap",
});

export const ofScript = Allura({
  subsets: ["latin"],
  weight: "400",
  variable: "--of-font-script",
  display: "swap",
});

export const ofSans = Inter({
  subsets: ["latin"],
  variable: "--of-font-sans",
  display: "swap",
});

export const ofMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--of-font-mono",
  display: "swap",
});

/** The combined font-variable classNames to spread onto the OpenFlow root. */
export const openFlowFontVars = [
  ofSerif.variable,
  ofScript.variable,
  ofSans.variable,
  ofMono.variable,
].join(" ");
