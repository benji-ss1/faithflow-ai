// Shared, dependency-free text normaliser for the allusion matcher.
//
// Used by BOTH the offline index builder (scripts/build-allusion-index.mjs)
// and the runtime matcher (allusion-matcher.ts), so Bible text and live
// transcript words are reduced to exactly the same content-word tokens.
// Any change here changes the hashes → bump ALLUSION_NORMALIZER_VERSION and
// rebuild the index (`npm run allusion:index`).
//
// NOTE: this is NOT the accent/ASR repair layer (bible-parser / context-parser
// own that). It only folds archaic KJV forms, spelling variants and simple
// inflection so "he doeth according to his will" ≈ "he does according to his will".

export const ALLUSION_NORMALIZER_VERSION = "n2";

const ARCHAIC: Record<string, string> = {
  thee: "you", thou: "you", ye: "you", thy: "your", thine: "your",
  hath: "has", hast: "have", doth: "does", dost: "do", didst: "did",
  doeth: "does", goeth: "goes", seeth: "sees",
  saith: "says", art: "are", shalt: "shall", wilt: "will", canst: "can",
  couldest: "could", wouldest: "would", shouldest: "should", mayest: "may",
  spake: "spoke", unto: "to", wast: "was", wert: "were", hadst: "had",
  whatsoever: "whatever", whosoever: "whoever", wherefore: "why",
  sware: "swore", brake: "broke", gat: "got", clave: "clung",
  honour: "honor", favour: "favor", labour: "labor", saviour: "savior",
  neighbour: "neighbor", colour: "color", savour: "savor", armour: "armor",
  odour: "odor", succour: "succor", splendour: "splendor", valour: "valor",
  counsellor: "counselor", counsellors: "counselors", judgement: "judgment",
  // ASR writes small numbers as digits ("The 1 that has broken the gates").
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
  "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten", "12": "twelve",
};

// ~110 function words dropped before n-gramming (applied AFTER archaic folding).
const STOP = new Set(
  (
    "a an the and or but nor of to in on at for with by from as into onto upon out up down over under about " +
    "is are was were be been being am has have had having do does did done shall will would should can could may might must " +
    "i me my mine myself we us our ours you your yours he him his himself she her hers it its itself they them their theirs " +
    "this that these those there here which who whom whose what when where why how " +
    "not no so then than also all any even if because therefore now yet very too just only " +
    "let o oh lo behold yea verily said say says saying one ones thing things " +
    "go goes went come came make made get got like well know see"
  ).split(/\s+/),
);

export function isAllusionStopword(w: string): boolean {
  return STOP.has(w);
}

/** Light symmetric stemmer: identical on both sides, so exactness doesn't matter. */
export function stemAllusionWord(w: string): string {
  let s = w;
  if (s.length > 4) {
    if (s.endsWith("eth") && s.length > 5) s = s.slice(0, -3);
    else if (s.endsWith("est") && s.length > 6) s = s.slice(0, -3);
    else if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
    else if (s.endsWith("ied")) s = s.slice(0, -3) + "y";
    else if (s.endsWith("ed") && s.length > 5) s = s.slice(0, -2);
    else if (s.endsWith("ies")) s = s.slice(0, -3) + "y";
    else if (s.endsWith("es") && !s.endsWith("ses")) s = s.slice(0, -2);
    else if (s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us")) s = s.slice(0, -1);
  }
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  // doubled final consonant after stripping ("returned"→"return", "stopped"→"stopp"→"stop")
  if (s.length > 3 && s[s.length - 1] === s[s.length - 2] && !"aeiouls".includes(s[s.length - 1])) s = s.slice(0, -1);
  return s;
}

/** Raw lowercase word tokens (apostrophes removed, punctuation → space). */
export function allusionRawTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Content-word tokens: archaic-folded, stopword-stripped, stemmed. */
export function allusionContentWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of allusionRawTokens(text)) {
    const w = ARCHAIC[raw] ?? raw;
    if (STOP.has(w)) continue;
    if (/^\d+$/.test(w)) continue; // leftover numbers are verse numbers / noise
    out.push(stemAllusionWord(w));
  }
  return out;
}

/** FNV-1a 32-bit over the space-joined gram. Unsigned. */
export function allusionGramHash(a: string, b: string, c: string): number {
  const s = a + " " + b + " " + c;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
