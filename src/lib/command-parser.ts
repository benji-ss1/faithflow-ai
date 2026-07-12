/**
 * Natural-language operator commands.
 *
 * Every command MUST start with a configurable wake prefix (default:
 * "presentflow"). Without the prefix nothing here fires — the deliberate
 * design choice, to make it structurally impossible for a stray sermon
 * phrase like "next slide" to be interpreted as a command.
 *
 * Even with the prefix + match, the caller is expected to surface the
 * command as a *suggestion* requiring operator approval, exactly like
 * Bible/song detections. This module never executes anything itself.
 */

export type CommandVerb =
  | "next_slide"
  | "prev_slide"
  | "blank"
  | "logo"
  | "clear_live"
  | "show_reference"
  | "show_song";

export type ParsedCommand = {
  verb: CommandVerb;
  payload: Record<string, unknown>;
  confidence: number;
  matchedText: string;
};

// Each intent lists exact/near-exact phrases. Kept small on purpose.
const INTENTS: { verb: CommandVerb; phrases: RegExp[]; confidence: number; capture?: (m: RegExpExecArray) => Record<string, unknown> }[] = [
  {
    verb: "next_slide",
    phrases: [/^(?:next\s+slide|next|advance|forward)\b/, /^go\s+(?:to\s+the\s+)?next\b/],
    confidence: 90,
  },
  {
    verb: "prev_slide",
    phrases: [/^(?:previous\s+slide|previous|back|go\s+back)\b/, /^(?:go\s+)?back\s+(?:a|one)?\s*slide\b/],
    confidence: 90,
  },
  {
    verb: "blank",
    phrases: [/^(?:blank(?:\s+screen|\s+the\s+screen)?|black(?:\s+screen)?|hide(?:\s+the\s+screen)?)\b/],
    confidence: 92,
  },
  {
    verb: "logo",
    phrases: [/^(?:show|display)\s+(?:the\s+)?logo\b/, /^logo\b/],
    confidence: 92,
  },
  {
    verb: "clear_live",
    phrases: [/^(?:clear(?:\s+the\s+screen|\s+live)?|kill(?:\s+it|\s+the\s+screen)?)\b/],
    confidence: 90,
  },
  {
    verb: "show_reference",
    phrases: [/^show\s+(?:me\s+)?(.+)$/, /^bring\s+up\s+(.+)$/, /^pull\s+up\s+(.+)$/],
    confidence: 65,
    capture: (m) => ({ query: m[1].trim() }),
  },
];

/**
 * Parse a transcript segment for wake-prefixed commands.
 * Returns 0 or more ParsedCommand — normally 0 or 1.
 */
export function parseCommands(text: string, prefix: string): ParsedCommand[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];

  const norm = text.toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[.,!?;:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Find "prefix ..." — allow up to 12 words of trailing content.
  const prefixRe = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[,\\s]+(.+)$`, "i");
  const m = prefixRe.exec(norm);
  if (!m) return [];
  const rest = m[1].trim();
  if (!rest) return [];

  const matches: ParsedCommand[] = [];
  for (const intent of INTENTS) {
    for (const re of intent.phrases) {
      const im = re.exec(rest);
      if (im) {
        const payload = intent.capture ? intent.capture(im) : {};
        matches.push({
          verb: intent.verb,
          payload,
          confidence: intent.confidence,
          matchedText: `${prefix} ${im[0]}`.trim(),
        });
        break; // first matching phrase per intent wins
      }
    }
  }
  // Prefer highest-confidence single match to reduce noise.
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches.slice(0, 1);
}
