// Shared colour swatches for Playlist section headers AND Library labels
// (Wave 3). One palette, one source of truth, so recolor menus match across the
// left rail. ProPresenter service-section taxonomy (Ch 13).
export const SECTION_COLORS: { name: string; value: string }[] = [
  { name: "Pre-Service", value: "#7c3aed" }, // purple
  { name: "Welcome", value: "#2563eb" },     // blue
  { name: "Worship", value: "#16a34a" },     // green
  { name: "Teaching", value: "#ea580c" },    // orange
  { name: "Response", value: "#ca8a04" },    // yellow
  { name: "Closing", value: "#dc2626" },     // red
];

// Worship green — the default for a freshly-added playlist header.
export const DEFAULT_HEADER_COLOR = SECTION_COLORS[2].value;
