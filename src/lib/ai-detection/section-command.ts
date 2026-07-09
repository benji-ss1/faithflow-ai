// Section-jump commands for a currently-staged song ("go to chorus",
// "show verse two", "the bridge"). Distinct from generic slide navigation
// (see context-parser.ts) — these only fire when a song is staged.

export type SongSection = "chorus" | "verse" | "bridge" | "outro" | "tag";

export type SectionCommand = {
  verb: "jump_section";
  section: SongSection;
  index?: number;         // e.g. "verse two" → 2
  confidence: number;
  matchedText: string;
};

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
function toIndex(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  const n = Number(s);
  if (!Number.isNaN(n) && n > 0 && n < 50) return n;
  return WORD_NUM[s];
}

const PATTERNS: { re: RegExp; section: SongSection; confidence: number; capturesIndex?: boolean }[] = [
  // "go to verse two", "show verse 2", "play the second verse"
  { re: /\b(?:go\s+to|jump\s+to|show|play)\s+(?:the\s+)?verse\s+([a-z0-9]+)\b/i, section: "verse", confidence: 88, capturesIndex: true },
  { re: /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+verse\b/i, section: "verse", confidence: 82, capturesIndex: true },

  // "go to chorus", "the chorus"
  { re: /\b(?:go\s+to|jump\s+to|show|play|back\s+to)\s+(?:the\s+)?chorus\b/i, section: "chorus", confidence: 90 },
  { re: /\bthe\s+chorus\s+again\b/i, section: "chorus", confidence: 82 },

  // "bridge"
  { re: /\b(?:go\s+to|jump\s+to|show|play|hit)\s+(?:the\s+)?bridge\b/i, section: "bridge", confidence: 90 },
  { re: /\bthe\s+bridge\b/i, section: "bridge", confidence: 68 },

  // "outro" / "tag"
  { re: /\b(?:go\s+to|jump\s+to|show|play)\s+(?:the\s+)?outro\b/i, section: "outro", confidence: 88 },
  { re: /\b(?:go\s+to|jump\s+to|show|play)\s+(?:the\s+)?tag\b/i, section: "tag", confidence: 82 },
];

/**
 * Detect a song section-jump command. Only meaningful when a song is
 * currently staged; caller is responsible for that context check.
 */
export function detectSectionCommand(text: string): SectionCommand | null {
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const idx = p.capturesIndex ? toIndex(m[1]) : undefined;
    if (p.capturesIndex && idx === undefined) continue;
    return {
      verb: "jump_section",
      section: p.section,
      index: idx,
      confidence: p.confidence,
      matchedText: m[0],
    };
  }
  return null;
}
