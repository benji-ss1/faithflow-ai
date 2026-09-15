// Run: npx tsx test/electron-codesign.test.ts
// Guards the macOS auto-update signature gate (electron/codesign.ts), wired
// into electron/main.ts → isCurrentAppSigned.
import assert from "node:assert/strict";
import { isDeveloperIdSigned, isSignedFromResult, resolveBundlePath } from "../electron/codesign";

// Real `codesign -dv --verbose=2` output for a Developer ID signed app.
// Every one of these lines arrives on STDERR — that was the shipped bug.
const SIGNED_DEVELOPER_ID = `Executable=/Applications/PresentFlow.app/Contents/MacOS/PresentFlow
Identifier=com.presentflow.app
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=30+7 location=embedded
Signature size=9000
Authority=Developer ID Application: PresentFlow Ltd (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=15 Sep 2026 at 10:22:31
Info.plist entries=28
TeamIdentifier=ABCDE12345
Sealed Resources version=2 rules=13 files=412
Internal requirements count=1 size=180
`;

const AD_HOC = `Executable=/Users/dev/PresentFlow.app/Contents/MacOS/PresentFlow
Identifier=com.presentflow.app
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20400 size=999 flags=0x2(adhoc) hashes=30+7 location=embedded
Signature=adhoc
Info.plist entries=28
TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=412
`;

const UNSIGNED = `/Users/dev/PresentFlow.app: code object is not signed at all
In architecture: x86_64
`;

// Apple's own system apps are signed by "Software Signing", not Developer ID.
const APPLE_SYSTEM = `Identifier=com.apple.Safari
Authority=Software Signing
Authority=Apple Code Signing Certification Authority
Authority=Apple Root CA
TeamIdentifier=not set
`;

// --- isDeveloperIdSigned: text parsing -------------------------------------
assert.equal(isDeveloperIdSigned(SIGNED_DEVELOPER_ID), true, "Developer ID signed app must pass");
assert.equal(isDeveloperIdSigned(AD_HOC), false, "ad-hoc signed app must NOT start the updater");
assert.equal(isDeveloperIdSigned(UNSIGNED), false, "unsigned app must NOT start the updater");
assert.equal(isDeveloperIdSigned(APPLE_SYSTEM), false, "Apple Software Signing is not Developer ID");

// Fail closed on nothing / noise.
assert.equal(isDeveloperIdSigned(""), false, "empty output fails closed");
assert.equal(isDeveloperIdSigned("   \n\n "), false, "whitespace-only fails closed");
assert.equal(isDeveloperIdSigned("command not found: codesign"), false, "garbage fails closed");
assert.equal(isDeveloperIdSigned(undefined as unknown as string), false, "undefined fails closed");
assert.equal(isDeveloperIdSigned(null as unknown as string), false, "null fails closed");

// Apple-Development / self-signed certs are NOT Developer ID — Squirrel.Mac
// would still reject the update, so they must not open the gate.
assert.equal(
  isDeveloperIdSigned("Authority=Apple Development: dev@example.com (X1Y2Z3)\nTeamIdentifier=ABCDE12345\n"),
  false,
  "Apple Development cert is not Developer ID",
);

// An unsigned blob that happens to mention the phrase in prose must not pass.
assert.equal(
  isDeveloperIdSigned("PresentFlow.app: code object is not signed at all (expected Authority=Developer ID Application)"),
  false,
  "explicit not-signed wins over an incidental mention",
);

// Leading whitespace (some codesign builds indent) still parses.
assert.equal(
  isDeveloperIdSigned("   Authority=Developer ID Application: PresentFlow Ltd (ABCDE12345)\n   TeamIdentifier=ABCDE12345\n"),
  true,
  "indented Authority line still parses",
);

// --- forgery / near-miss hardening -----------------------------------------
// A self-signed keychain identity may use ANY common name, including a literal
// "Developer ID Application: ..." — and codesign still exits 0. Without a real
// 10-char Team ID it must be refused.
assert.equal(
  isDeveloperIdSigned(`Identifier=com.presentflow.app
Authority=Developer ID Application: Self Signed Me (ZZZZZ)
TeamIdentifier=not set
`),
  false,
  "self-signed identity without a valid TeamIdentifier must be refused",
);
assert.equal(
  isDeveloperIdSigned(`Authority=Developer ID Application: Self Signed Me (ZZZZZ)
TeamIdentifier=TOOSHORT
`),
  false,
  "malformed TeamIdentifier must be refused",
);
// The genuine article: Developer ID Application leaf + real Team ID.
assert.equal(
  isDeveloperIdSigned(`Authority=Developer ID Application: PresentFlow Ltd (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCDE12345
`),
  true,
  "Developer ID Application leaf with a valid TeamIdentifier passes",
);
// Intermediate CA line alone is not a leaf signature.
assert.equal(
  isDeveloperIdSigned("Authority=Developer ID Certification Authority\nTeamIdentifier=ABCDE12345\n"),
  false,
  "Developer ID Certification Authority alone (no leaf) must be refused",
);
// Newline injection via the echoed bundle path / Identifier: the blob below
// would satisfy the Authority + TeamIdentifier tests, so ONLY the adhoc guard
// stops it. This test is what makes that guard load-bearing.
assert.equal(
  isDeveloperIdSigned(`Executable=/tmp/evil
Authority=Developer ID Application: PresentFlow Ltd (ABCDE12345)/Contents/MacOS/x
Identifier=com.evil.app
CodeDirectory v=20400 size=999 flags=0x2(adhoc) hashes=30+7 location=embedded
Signature=adhoc
TeamIdentifier=ABCDE12345
`),
  false,
  "ad-hoc bundle with an injected Authority line must be refused",
);

// --- isSignedFromResult: spawn result branches -----------------------------
// The load-bearing case: detail lines on stderr, stdout empty (verified against
// Chrome / Claude / VS Code, which all emit 0 bytes on stdout).
assert.equal(
  isSignedFromResult({ status: 0, stdout: "", stderr: SIGNED_DEVELOPER_ID }),
  true,
  "signed app: stderr-only output must pass",
);
assert.equal(
  isSignedFromResult({ status: 0, stdout: SIGNED_DEVELOPER_ID, stderr: "" }),
  true,
  "stdout-carried output also passes (stream-agnostic)",
);
assert.equal(
  isSignedFromResult({ status: 0, stdout: "", stderr: AD_HOC }),
  false,
  "ad-hoc app fails even on a clean exit",
);
// TIMEOUT branch: spawnSync sets .error and leaves .status null after SIGKILL.
assert.equal(
  isSignedFromResult({ status: null, error: new Error("spawnSync codesign ETIMEDOUT"), stdout: "", stderr: "" }),
  false,
  "codesign timeout must fail closed",
);
assert.equal(
  isSignedFromResult({ status: null, error: new Error("ETIMEDOUT"), stdout: "", stderr: SIGNED_DEVELOPER_ID }),
  false,
  "timeout fails closed even with partial signed output already buffered",
);
// Other failure branches.
assert.equal(
  isSignedFromResult({ status: null, error: new Error("spawnSync codesign ENOENT") }),
  false,
  "codesign missing fails closed",
);
assert.equal(
  isSignedFromResult({ status: 1, stdout: "", stderr: UNSIGNED }),
  false,
  "non-zero exit fails closed",
);
assert.equal(isSignedFromResult(null), false, "null result fails closed");
assert.equal(isSignedFromResult(undefined), false, "undefined result fails closed");
assert.equal(isSignedFromResult({}), false, "empty result fails closed");

// --- resolveBundlePath -----------------------------------------------------
assert.equal(
  resolveBundlePath("/Applications/PresentFlow.app/Contents/Resources/app.asar"),
  "/Applications/PresentFlow.app",
  "packaged asar layout strips to the bundle",
);
assert.equal(
  resolveBundlePath("/Applications/PresentFlow.app/Contents/Resources/app"),
  "/Applications/PresentFlow.app",
  "unpacked layout strips to the bundle",
);
assert.equal(
  resolveBundlePath("/Applications/Present Flow.app/Contents/Resources/app.asar"),
  "/Applications/Present Flow.app",
  "paths with spaces survive",
);
assert.equal(
  resolveBundlePath("/Applications/PresentFlow.app/Contents/Resources/somewhere/else"),
  "/Applications/PresentFlow.app",
  "unexpected layout still finds the enclosing .app",
);
assert.equal(
  resolveBundlePath("/Applications/PresentFlow.app"),
  "/Applications/PresentFlow.app",
  "already-a-bundle is unchanged",
);
assert.equal(
  resolveBundlePath("/Volumes/My.apps/checkout/src"),
  "/Volumes/My.apps/checkout/src",
  ".apps is not a bundle segment — returned unchanged, caller fails closed",
);
assert.equal(
  resolveBundlePath("/Users/dev/faithflow-ai"),
  "/Users/dev/faithflow-ai",
  "dev (unpackaged) path returned unchanged",
);
assert.equal(resolveBundlePath(""), "", "empty path stays empty");
assert.equal(resolveBundlePath(undefined as unknown as string), "", "undefined path fails closed to empty");

console.log("✓ electron-codesign: all assertions passed");
