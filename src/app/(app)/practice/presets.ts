// Preset transcripts for Practice Mode. Server-only.
// The Sunday-morning preset reads the CP6 dry-run transcript from disk so
// operator practice matches the same corpus we run through detectAll in
// automated tests. Other presets are inline abridged scripts.
import fs from "node:fs";
import path from "node:path";

export type PracticeSegment = {
  tMs: number;
  text: string;
  expected?: {
    scripture?: { book: string; ch: number; vs: number; ve: number };
    song?: string;
    command?: string;
    low_confidence?: true;
  };
};

export type PracticePreset = {
  id: string;
  label: string;
  description: string;
  segments: PracticeSegment[];
};

function loadSundayServiceTranscript(): PracticeSegment[] {
  try {
    const p = path.join(process.cwd(), "test", "dry-run", "sunday-service.transcript.json");
    const raw = fs.readFileSync(p, "utf-8");
    const arr = JSON.parse(raw) as PracticeSegment[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function getPresets(): PracticePreset[] {
  const sunday = loadSundayServiceTranscript();
  return [
    {
      id: "sunday",
      label: "Sunday morning service",
      description: "Full 45–60 minute service walk-through with hymns, scripture, and announcements.",
      segments: sunday,
    },
    {
      id: "wednesday",
      label: "Wednesday small group",
      description: "Bible-study style with several scripture references and one worship song.",
      segments: [
        { tMs: 0, text: "Welcome everyone to Wednesday small group." },
        { tMs: 8000, text: "Let's open with a short worship — Amazing Grace." , expected: { song: "Amazing Grace" } },
        { tMs: 40000, text: "Please open your Bibles to Romans chapter 12 verse 1.", expected: { scripture: { book: "Romans", ch: 12, vs: 1, ve: 1 } } },
        { tMs: 70000, text: "I beseech you therefore brethren by the mercies of God." },
        { tMs: 95000, text: "Let's read on to verse 2 as well." , expected: { command: "next" } },
        { tMs: 130000, text: "Turn with me to James 1 verse 22.", expected: { scripture: { book: "James", ch: 1, vs: 22, ve: 22 } } },
        { tMs: 160000, text: "But be ye doers of the word and not hearers only." },
        { tMs: 195000, text: "Let's close in Philippians 4 verse 6 through 7.", expected: { scripture: { book: "Philippians", ch: 4, vs: 6, ve: 7 } } },
        { tMs: 220000, text: "Be careful for nothing but in every thing by prayer and supplication." },
      ],
    },
    {
      id: "baptism",
      label: "Baptism service",
      description: "Shorter service focused on a baptism liturgy and two hymns.",
      segments: [
        { tMs: 0, text: "Welcome church, today is a joyful day of baptism." },
        { tMs: 15000, text: "Let's stand and sing Holy Holy Holy together.", expected: { song: "Holy, Holy, Holy" } },
        { tMs: 45000, text: "Holy holy holy Lord God almighty." },
        { tMs: 70000, text: "Please turn to Matthew 28 verses 18 to 20.", expected: { scripture: { book: "Matthew", ch: 28, vs: 18, ve: 20 } } },
        { tMs: 100000, text: "Go ye therefore and teach all nations baptising them." },
        { tMs: 140000, text: "As we prepare, let's sing How Great Thou Art.", expected: { song: "How Great Thou Art" } },
        { tMs: 175000, text: "Oh Lord my God when I in awesome wonder." },
        { tMs: 210000, text: "Fade to the baptism camera please.", expected: { command: "fade" } },
      ],
    },
  ];
}
