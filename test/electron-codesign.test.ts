// Run: npx tsx test/electron-codesign.test.ts
// Guards the macOS auto-update signature gate (electron/codesign.ts), wired
// into electron/main.ts → isCurrentAppSigned.
import assert from "node:assert/strict";
import { isDeveloperIdSigned } from "../electron/codesign";

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

assert.equal(isDeveloperIdSigned(SIGNED_DEVELOPER_ID), true, "Developer ID signed app must pass");
assert.equal(isDeveloperIdSigned(AD_HOC), false, "ad-hoc signed app must NOT start the updater");
assert.equal(isDeveloperIdSigned(UNSIGNED), false, "unsigned app must NOT start the updater");

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
  isDeveloperIdSigned("   Authority=Developer ID Application: PresentFlow Ltd (ABCDE12345)\n"),
  true,
  "indented Authority line still parses",
);

console.log("✓ electron-codesign: 11 assertions passed");
