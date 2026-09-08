// Single source of truth for #rrggbb validation, shared by playlist-header
// recolor and library colour labels (Wave 3). Six-digit hex only (the picker
// and DB both store #rrggbb); no shorthand, no alpha.

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** True iff `value` is a #rrggbb hex string. */
export function isHex6Color(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}
