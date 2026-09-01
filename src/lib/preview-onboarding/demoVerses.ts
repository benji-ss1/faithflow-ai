// Bundled public-domain KJV verses for the onboarding PREVIEW's "magic moment"
// only. The real Bible lookup APIs are desktop-gated (403 on web), so the web
// preview ships a handful of famous verses client-side — zero API calls, works
// offline, and is enough to demonstrate say-a-reference → detect → project.
// NOT used anywhere in the real product; preview scaffolding only.

export type DemoVerse = { ref: string; translation: string; text: string };

// Keyed by normalized "<book> <chapter>:<verse>" (book lowercased) so a parsed
// reference maps straight in.
export const DEMO_VERSES: Record<string, DemoVerse> = {
  "john 3:16": {
    ref: "John 3:16",
    translation: "KJV",
    text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  },
  "romans 8:1": {
    ref: "Romans 8:1",
    translation: "KJV",
    text: "There is therefore now no condemnation to them which are in Christ Jesus, who walk not after the flesh, but after the Spirit.",
  },
  "psalms 23:1": {
    ref: "Psalm 23:1",
    translation: "KJV",
    text: "The LORD is my shepherd; I shall not want.",
  },
  "psalm 23:1": {
    ref: "Psalm 23:1",
    translation: "KJV",
    text: "The LORD is my shepherd; I shall not want.",
  },
  "philippians 4:13": {
    ref: "Philippians 4:13",
    translation: "KJV",
    text: "I can do all things through Christ which strengtheneth me.",
  },
  "jeremiah 29:11": {
    ref: "Jeremiah 29:11",
    translation: "KJV",
    text: "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.",
  },
};

export const DEMO_VERSE_SUGGESTIONS = ["John 3:16", "Romans 8:1", "Psalm 23:1", "Philippians 4:13"];

export function lookupDemoVerse(book: string, chapter: number, verse: number): DemoVerse | null {
  const key = `${book.toLowerCase().trim()} ${chapter}:${verse}`;
  return DEMO_VERSES[key] ?? null;
}
