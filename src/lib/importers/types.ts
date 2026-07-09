// Pluggable per-platform importer contract.
//
// Adding a 9th/10th platform: create a new file next to this one that
// exports a `Parser<T>` object, register it in `registry.ts`. No changes
// to the pipeline runner or UI needed.

export type ParsedSong = {
  title: string;
  artist: string | null;
  ccli: string | null;
  slides: string[];          // per-slide lyrics, already plain text
  mediaHints: string[];       // filenames referenced by the song's slides
  sourceRef?: string;         // path or id in the original library
  warnings: string[];
};

export type ImportedItem =
  | { kind: "song"; song: ParsedSong }
  | { kind: "media"; media: { fileName: string; mimeType: string; contents: Buffer } }
  | { kind: "logo"; media: { fileName: string; mimeType: string; contents: Buffer; confidence: number } };

export type ImportReport = {
  parser: string;                          // parser id, e.g. "propresenter"
  itemsExamined: number;
  itemsImported: number;
  itemsSkipped: number;
  warnings: { file: string; warnings: string[] }[];
};

export type ImporterInput = {
  files: { path: string; contents: Buffer }[]; // path is relative to the drop
};

export type Parser = {
  id: "propresenter" | "opensong" | "openlyrics" | "csv";
  displayName: string;
  /** Which files this parser can handle from the drop. */
  match: (path: string) => boolean;
  /** Parse ONE matching file. Never throws — returns [] + warnings on error. */
  parseFile: (path: string, contents: Buffer) => ImportedItem[];
};
