// Shared #rrggbb validator for the section/library colour paths (Wave 3):
// `setHeaderColor`, `setLibraryColor`, and the `addServiceItem` "header" case
// (via `addPlaylistHeader`). Six-digit hex only (the picker and DB both store
// #rrggbb); no shorthand, no alpha. NOT a repo-wide unifier — other hex checks
// (e.g. the 3-digit expander + auto-contrast helpers in actions.ts) are a
// different concern and intentionally left alone.

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** True iff `value` is a #rrggbb hex string. */
export function isHex6Color(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}
