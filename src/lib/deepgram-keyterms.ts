/**
 * Deepgram keyterm prompting list.
 *
 * These are hint terms Deepgram nova-3 uses to bias its transcription so
 * scripture book names, church-specific vocabulary, and worship phrases are
 * transcribed correctly (e.g. "Ecclesiastes" instead of "a see zesee").
 *
 * Passed to the Deepgram streaming endpoint as repeated URL params:
 * `keyterm=Deuteronomy&keyterm=Ecclesiastes&...`. Order does not matter.
 *
 * Edit this file to add scripture books, member/leader names, ministry
 * team names, or common worship phrases — no changes to the connection
 * logic required.
 */
export const DEEPGRAM_KEYTERMS: string[] = [
  // Scripture books whose names Deepgram commonly mangles.
  "Deuteronomy",
  "Ecclesiastes",
  "Obadiah",
  "Matthew",
  "Colossians",
  "Songs of Solomon",
  "Malachi",
  "Micah",
  "Ephesians",
  "Proverbs",
  "Nahum",
  "Amos",
];
