/**
 * ProPresenter .pro6 parser.
 *
 * Format research summary:
 *   - `.pro6` is a single XML file (root: RVPresentationDocument).
 *   - Slide text lives in <RVTextElement> nodes as either an rtfData
 *     attribute (base64-encoded RTF) or, in some exports, a plain
 *     `plainTextData` / body-tag payload.
 *   - Song metadata (title, author, CCLI) is on the root element as
 *     attributes: `CCLISongTitle`, `CCLIAuthor`, `CCLISongNumber`.
 *
 * This parser targets that structure. It won't handle every edge case
 * (esp. .pro7 which is JSON-based); the caller reports any file that
 * failed to parse rather than silently dropping it.
 */

import { XMLParser } from "fast-xml-parser";

export type ParsedProSong = {
  title: string;
  artist: string | null;
  ccli: string | null;
  slides: string[];
  /** Warnings for the caller to surface, e.g. "Slide 3 had no readable text" */
  warnings: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  isArray: () => false,
});

/** Decode base64-encoded RTF and strip the control words to plain text. */
function decodeRtf(b64: string): string {
  try {
    const rtf = Buffer.from(b64, "base64").toString("utf8");
    // Strip RTF: control words, groups, hex escapes. Not a real RTF parser
    // — just gets a workable plain-text approximation for slide lyrics.
    let s = rtf
      .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
      .replace(/[{}]/g, "")
      .replace(/\\\*/g, "")
      .replace(/\\\\/g, "\\")
      .trim();
    // Collapse whitespace and normalise line endings
    s = s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return s.trim();
  } catch {
    return "";
  }
}

function walkForTextElements(node: unknown, out: string[]) {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  // RVTextElement with an rtfData attribute
  if ("RVTextElement" in obj) {
    const arr = Array.isArray(obj.RVTextElement) ? obj.RVTextElement : [obj.RVTextElement];
    for (const el of arr) {
      const rtf = (el as Record<string, string>)?.["@_RTFData"];
      if (rtf) {
        const text = decodeRtf(rtf);
        if (text) out.push(text);
      }
    }
  }

  // Some exports store slide text inside NSString or plaintext directly
  if ("NSString" in obj) {
    const s = obj.NSString as string;
    if (typeof s === "string" && s.trim()) out.push(s.trim());
  }

  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (Array.isArray(child)) child.forEach((c) => walkForTextElements(c, out));
    else if (typeof child === "object") walkForTextElements(child, out);
  }
}

export function parsePro6(xml: string): ParsedProSong {
  const warnings: string[] = [];
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = (parsed.RVPresentationDocument as Record<string, unknown>) || parsed;
  if (!root || typeof root !== "object") {
    return { title: "Untitled", artist: null, ccli: null, slides: [], warnings: ["File is not a recognizable .pro6 document"] };
  }

  const title = (root["@_CCLISongTitle"] as string) || (root["@_docType"] as string) || "Untitled";
  const artist = (root["@_CCLIAuthor"] as string) || null;
  const ccli = (root["@_CCLISongNumber"] as string) || null;

  const slides: string[] = [];
  walkForTextElements(root, slides);

  if (slides.length === 0) warnings.push("No slide text found — file may be in .pro7 JSON format or use images-only slides");

  return { title, artist, ccli, slides, warnings };
}
