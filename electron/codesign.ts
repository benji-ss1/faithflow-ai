// Pure parsing helper for the macOS code-signature gate that guards
// electron-updater (see main.ts → isCurrentAppSigned).
//
// IMPORTANT: `codesign -dv --verbose=2 <bundle>` writes ALL of its detail
// lines — Identifier, Authority, TeamIdentifier, Signature — to STDERR, not
// stdout. Reading stdout alone (the 2026-09 bug) yields an empty string, so the
// gate always failed and auto-updates never started even on properly signed
// builds. Callers MUST pass stdout + stderr combined.
//
// Fails CLOSED: anything that isn't an explicit Developer ID authority line
// (unsigned, ad-hoc, empty, garbage) returns false.

export function isDeveloperIdSigned(output: string): boolean {
  if (typeof output !== "string" || output.trim() === "") return false;
  // Explicit "not signed" wins over anything else in the blob.
  if (/code object is not signed at all/i.test(output)) return false;
  // Ad-hoc signatures have no Authority chain at all ("Signature=adhoc"),
  // so the Authority test below already rejects them; this is belt-and-braces.
  if (/^\s*Signature=adhoc\s*$/im.test(output)) return false;
  // A real Developer ID chain prints e.g.
  //   Authority=Developer ID Application: PresentFlow Ltd (ABCDE12345)
  return /^\s*Authority=Developer ID\b/im.test(output);
}
