// Mic boost policy (2026-09-16 Windows polish round 2). Pure — unit-tested in
// test/mic-boost-policy.test.ts. macOS output is identical to the original
// inline logic in useAudioStream.ts.
//
// Why Windows differs: Windows "Microphone Boost" (+10..+30 dB) and a 100%
// input level sit BEFORE our software boost, so the old 1.5x default for an
// unset mic source stacked into clipping ("audio too hot"), which garbles ASR.
// An operator's explicit saved boost is always respected on every platform.

export function resolveMicBoost(opts: { raw: string | null; isMicSource: boolean; isWindows: boolean }): number {
  const def = opts.isMicSource ? (opts.isWindows ? 1 : 1.5) : 1;
  const parsed = opts.raw === null ? def : parseFloat(opts.raw);
  // Mixer feeds are line-level: cap 2x; bare mics keep 3x headroom.
  const max = opts.isMicSource ? 3 : 2;
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : 1;
}

/** Default boost shown in the settings UI when the operator hasn't chosen one. */
export function defaultMicBoost(isMicSource: boolean, isWindows: boolean): number {
  return isMicSource ? (isWindows ? 1 : 1.5) : 1;
}

export const WINDOWS_INPUT_GUIDANCE =
  "Windows tip: in Sound settings › More sound settings › Recording › your mic › Properties › Levels, set the level to about 70 and Microphone Boost to 0 dB. Windows' own boost stacks with PresentFlow's and makes the audio crackle, which garbles the AI.";
