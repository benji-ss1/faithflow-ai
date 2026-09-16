// Pure helpers for the macOS code-signature gate that guards electron-updater
// (see main.ts → isCurrentAppSigned).
//
// IMPORTANT: `codesign -dv --verbose=2 <bundle>` writes ALL of its detail
// lines — Identifier, Authority, TeamIdentifier, Signature — to STDERR, not
// stdout. Reading stdout alone (the 2026-09 bug) yields an empty string, so the
// gate always failed and auto-updates never started even on properly signed
// builds. Callers MUST pass stdout + stderr combined.
//
// Everything here fails CLOSED: anything that isn't an explicit Developer ID
// authority line (unsigned, ad-hoc, empty, garbage, timeout) returns false.

export function isDeveloperIdSigned(output: string): boolean {
  if (typeof output !== "string" || output.trim() === "") return false;
  // Explicit "not signed" wins over anything else in the blob.
  if (/code object is not signed at all/i.test(output)) return false;
  // REQUIRED, NOT redundant — do not delete. codesign echoes attacker//author-
  // controlled text (the bundle path, Identifier) into this blob, so an ad-hoc
  // bundle whose path or Identifier embeds a literal newline followed by
  // "Authority=Developer ID Application: ..." produces a line that satisfies
  // the Authority test below. This guard is the only thing that stops it.
  if (/^\s*Signature=adhoc\s*$/im.test(output)) return false;
  // A real Developer ID LEAF prints e.g.
  //   Authority=Developer ID Application: PresentFlow Ltd (ABCDE12345)
  // Anchor on "Developer ID Application" specifically: the intermediate line
  // "Authority=Developer ID Certification Authority" must not satisfy this on
  // its own, and Apple Development / Mac Developer certs never match.
  if (!/^\s*Authority=Developer ID Application\b/im.test(output)) return false;
  // A self-signed keychain identity can be given any CN it likes — including a
  // literal "Developer ID Application: ..." — and codesign still exits 0. Only
  // a real Apple-issued cert carries a 10-character alphanumeric Team ID, so
  // require one (ad-hoc/self-signed print "TeamIdentifier=not set").
  return /^\s*TeamIdentifier=[A-Z0-9]{10}\s*$/m.test(output);
}

/** The shape of the spawnSync result this gate cares about. */
export type CodesignSpawnResult = {
  status?: number | null;
  error?: Error | null;
  stdout?: string | null;
  stderr?: string | null;
};

/**
 * Whole verdict for one codesign invocation, kept pure so the failure branches
 * (timeout, spawn error, non-zero exit) are unit-testable without spawning
 * anything. On a spawnSync timeout Node sets `error` and leaves `status` null —
 * both are rejected here.
 */
export function isSignedFromResult(res: CodesignSpawnResult | null | undefined): boolean {
  if (!res) return false;
  if (res.error) return false; // spawn failed, codesign missing, or timed out
  if (res.status !== 0) return false; // non-zero exit, or null after SIGKILL
  return isDeveloperIdSigned(`${res.stdout || ""}\n${res.stderr || ""}`);
}

/**
 * app.getAppPath() points at .../Foo.app/Contents/Resources/app[.asar] in a
 * packaged build; codesign wants the .app bundle. Strip the known suffix, then
 * fall back to the nearest enclosing .app directory if the layout differs.
 * Returns the input unchanged when nothing matches — the caller fails closed.
 */
export function resolveBundlePath(appPath: string): string {
  if (typeof appPath !== "string" || appPath === "") return "";
  const stripped = appPath.replace(/\/Contents\/Resources\/app(?:\.asar)?$/, "");
  // Greedy match ends at the LAST ".app" that is a whole path segment, so
  // "/Volumes/My.apps/x" is not mistaken for a bundle.
  const m = /^(.*\.app)(?:\/|$)/.exec(stripped);
  return m ? m[1] : stripped;
}
