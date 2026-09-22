/**
 * Video codec detection — so a Mac-exported video is never silently black on a
 * Windows church's projector.
 *
 * THE PROBLEM: `.mov` is an allowed upload type, and Mac/iPhone exports are
 * usually **HEVC (H.265)**. Electron ships stock Chromium, whose bundled ffmpeg
 * does not carry an HEVC decoder on Windows. So a background that plays
 * perfectly while you build the service on a Mac can render as nothing at all
 * on a Windows machine — mid-service, with no error anyone sees. Many of our
 * churches are on Windows, so this is a real failure mode, not a theoretical one.
 *
 * We do two things: warn at UPLOAD (when it is cheap to pick a different file)
 * and surface it at PLAYBACK (so an operator is never left guessing).
 *
 * Detection is a fourcc scan of the MP4/QuickTime header, not a full demux —
 * `hvc1`/`hev1` for HEVC, `avc1` for H.264. That is enough to tell the operator
 * something useful, and it cannot be wrong in a damaging way: the worst case is
 * a warning about a file that would have been fine.
 */

export type VideoCodec = "hevc" | "h264" | "av1" | "vp9" | "unknown";

/** Four-character codes as they appear in the sample-description box. */
const FOURCC: Array<[string, VideoCodec]> = [
  ["hvc1", "hevc"], ["hev1", "hevc"], ["hvcC", "hevc"],
  ["avc1", "h264"], ["avcC", "h264"],
  ["av01", "av1"],
  ["vp09", "vp9"],
];

/**
 * Identify the video codec from the first chunk of a file. Pure — pass bytes,
 * get an answer. 64KB is plenty: the `moov` box that names the codec is at the
 * start in every file a phone or an editor produces (and when it is at the END,
 * as in a non-faststart export, we return "unknown" and stay silent rather than
 * guess wrong).
 */
export function probeVideoCodec(head: Uint8Array): VideoCodec {
  if (!head || head.length < 8) return "unknown";
  // Decode as latin1 so byte values map 1:1 to characters — fourccs are ASCII.
  let s = "";
  for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
  for (const [code, codec] of FOURCC) {
    if (s.includes(code)) return codec;
  }
  return "unknown";
}

/** How much of the file we need to read to make that call. */
export const CODEC_PROBE_BYTES = 64 * 1024;

/**
 * Can the CURRENT browser/Electron build play HEVC? Chromium on Windows
 * generally cannot; Safari and Electron on macOS generally can.
 *
 * Returns `null` when we cannot tell (no DOM, or the browser reports the
 * useless empty string) so callers can stay quiet rather than cry wolf.
 */
export function canPlayHevcHere(): boolean | null {
  try {
    if (typeof document === "undefined") return null;
    const v = document.createElement("video");
    if (typeof v.canPlayType !== "function") return null;
    // "probably"/"maybe" both mean it will try; "" means it definitely will not.
    const a = v.canPlayType('video/mp4; codecs="hvc1"');
    const b = v.canPlayType('video/mp4; codecs="hev1"');
    if (a === "" && b === "") return false;
    if (a || b) return true;
    return null;
  } catch { return null; }
}

/**
 * The operator-facing warning for a file about to be uploaded, or null when
 * there is nothing worth saying.
 *
 * Deliberately warns even when THIS machine can play it — the point is the
 * OTHER machine. A Mac operator uploading for a Windows church is exactly the
 * case that bites, and it is the case where a local capability check would
 * wrongly stay silent.
 */
export function uploadCodecWarning(codec: VideoCodec): string | null {
  if (codec !== "hevc") return null;
  return "This video is HEVC (H.265), which Windows computers usually cannot play. "
    + "It will look fine here but may show as a black screen on a Windows machine. "
    + "Re-export it as H.264 MP4 if any of your operators use Windows.";
}

/** The message to show when a video genuinely fails to play. */
export function playbackFailureMessage(codec: VideoCodec | null): string {
  if (codec === "hevc") {
    return "This video could not play on this computer — it is HEVC (H.265), which Windows usually cannot decode. Re-export it as H.264 MP4.";
  }
  return "This video could not be played. Check the file, or re-export it as H.264 MP4.";
}
