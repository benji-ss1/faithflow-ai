// Sarah audio setup: beta-application matching uses multiple signals, never email
// alone, and NEVER releases another church's application details on a name guess.
import { scoreApplication, bestApplicationMatch, extractSetup, churchNameSimilarity, type ApplicationRow } from "../src/lib/audio/applicationMatch";
import { sanitizeProfile, isMissingProfilesTable } from "../src/lib/server/audio-setup";

let passed = 0; let failed = 0;
function check(name: string, cond: boolean) { if (cond) passed++; else { failed++; console.error(`FAIL: ${name}`); } }

const answers = (church: string, desk = "Behringer X32", device = "Mac", city = "Lagos") => [
  { question: "What's your church called, and where?", answer: `Church name: ${church} · City: ${city} · Country: Nigeria` },
  { question: "What device runs your presentations?", answer: device },
  { question: "What soundboard / mixer does your church use?", answer: desk },
  { question: "What do you run today — and for how long?", answer: "ProPresenter 7, 4 years" },
  { question: "What's your name?", answer: "First name: Samuel · Last name: Ade" },
];
const app = (o: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id: "11111111-1111-1111-1111-111111111111", churchName: "RCCG Grace Chapel", contactEmail: "pastor@gracechapel.org",
  answers: answers("RCCG Grace Chapel"), createdAt: "2026-08-01", ...o,
});
const ctx = { userEmail: "tech@gracechapel.org", userName: "Tolu B", memberEmails: ["tech@gracechapel.org"], churchName: "Grace Chapel Lagos", city: "Lagos", country: "Nigeria" };

// ── name similarity ──
check("ignores stopwords + location", churchNameSimilarity("RCCG Grace Chapel", "Grace Chapel Lagos", ["Lagos"]) >= 0.6);
check("different churches → 0", churchNameSimilarity("Redemption House", "Grace Chapel") === 0);
// A single shared distinctive word ("Life", "Grace") CAN read as a name match — that's why a
// name match alone never releases details (see the redaction checks below).
check("single shared distinctive word still needs an identity signal", (() => {
  const nameOnly = scoreApplication(app({ churchName: "Life Church Lagos", answers: answers("Life Church Lagos"), contactEmail: "x@stranger.test" }),
    { userEmail: "me@other.test", memberEmails: ["me@other.test"], churchName: "House of Life", city: "London", country: "UK" });
  return !nameOnly.identityMatched && nameOnly.confidence !== "high" && nameOnly.setup.desk === undefined;
})());
check("accents are normalized", churchNameSimilarity("Église Évangélique de Paris", "Eglise Evangelique Paris") >= 0.6);

// ── extraction ──
const s1 = extractSetup(app());
check("extract desk", s1.desk === "Behringer X32");
check("extract device", s1.device === "Mac");
check("extract city/country", s1.city === "Lagos" && s1.country === "Nigeria");
check("extract applicant", s1.applicantName === "Samuel Ade");
check("malformed answers tolerated", extractSetup(app({ answers: [null, 5, { question: 1 }] as unknown as [] })).desk === undefined);
check("null answers tolerated", extractSetup(app({ answers: null as unknown as [] })).desk === undefined);

// ── identity vs name-only ──
const m1 = scoreApplication(app(), ctx);
check("different applicant email but same church domain → high", m1.confidence === "high" && m1.identityMatched);
check("high match releases setup", m1.setup.desk === "Behringer X32" && m1.setup.applicantName === "Samuel Ade");

const stranger = scoreApplication(app({ contactEmail: "sam.ade@gmail.com" }), { ...ctx, userEmail: "ops@gmail.com", memberEmails: ["ops@gmail.com"] });
check("no identity signal → never high", stranger.confidence !== "high" && !stranger.identityMatched);
check("name-only match REDACTS the application", stranger.setup.desk === undefined && stranger.setup.applicantName === undefined && stranger.setup.city === undefined);
check("name-only keeps church name only", typeof stranger.setup.churchName === "string");
check("free-mail domains never count as a domain match", !stranger.signals.find((x) => x.key === "domain")!.matched);

// guessable single-word church name cannot unlock another church's details
const guess = scoreApplication(app({ churchName: "Grace Chapel Abuja", answers: answers("Grace Chapel Abuja", "Yamaha TF", "Windows", "Abuja"), contactEmail: "pastor@otherchurch.org" }),
  { userEmail: "a@evil.test", memberEmails: ["a@evil.test"], churchName: "Grace", city: "London", country: "UK" });
check("single-word guess → no identity, redacted", !guess.identityMatched && guess.setup.desk === undefined && guess.setup.applicantName === undefined);

// ── identity paths ──
check("same email (case-insensitive) → high", scoreApplication(app({ contactEmail: "TECH@gracechapel.org" }), ctx).confidence === "high");
check("verified team member email → high", scoreApplication(app({ contactEmail: "pastor@gmail.com" }), { ...ctx, memberEmails: ["tech@gracechapel.org", "pastor@gmail.com"] }).confidence === "high");
const conflict = scoreApplication(app({ contactEmail: "tech@gracechapel.org", churchName: "Redemption House", answers: answers("Redemption House") }), ctx);
check("church-name conflict vetoes high", conflict.confidence !== "high");
check("stopword-only names don't create a false conflict", scoreApplication(app({ contactEmail: "tech@gracechapel.org", churchName: "The Redeemed Christian Church", answers: answers("The Redeemed Christian Church") }), { ...ctx, churchName: "RCCG" }).confidence === "high");
check("accented own application still matches", scoreApplication(app({ contactEmail: "tech@gracechapel.org", churchName: "Église Évangélique", answers: answers("Église Évangélique") }), { ...ctx, churchName: "Eglise Evangelique" }).confidence === "high");
check("unrelated → none", scoreApplication(app({ contactEmail: "x@other.org", churchName: "Redemption House", answers: answers("Redemption House") }), { ...ctx, city: "Accra", country: "Ghana" }).confidence === "none");

// Verifier agent (2026-09-16): a shared PERSONAL-mail domain must not act as identity on its own.
const sharedHost = scoreApplication(
  app({ contactEmail: "someone@gmx.com", churchName: "Redemption House Abuja", answers: answers("Redemption House Abuja", "Yamaha TF", "Windows", "Abuja") }),
  { userEmail: "me@gmx.com", memberEmails: ["me@gmx.com"], churchName: "Grace Chapel Lagos", city: "Lagos", country: "Nigeria" });
check("shared free-mail host alone is not identity", !sharedHost.identityMatched);
check("shared free-mail host does not release details", sharedHost.setup.desk === undefined && sharedHost.setup.applicantName === undefined);
// A REAL church domain corroborated by the church name still works (the normal case).
check("church domain + matching name = identity", scoreApplication(app(), ctx).identityMatched === true);
// A church domain with a conflicting name and different city is NOT enough on its own.
const uncorroborated = scoreApplication(
  app({ contactEmail: "pastor@sharedhost.test", churchName: "Totally Different Assembly", answers: answers("Totally Different Assembly", "X32", "Mac", "Accra") }),
  { userEmail: "tech@sharedhost.test", memberEmails: ["tech@sharedhost.test"], churchName: "Grace Chapel Lagos", city: "Lagos", country: "Nigeria" });
check("uncorroborated domain is not identity", !uncorroborated.identityMatched && uncorroborated.setup.desk === undefined);

// ── best match ──
const best = bestApplicationMatch([
  app({ id: "a", contactEmail: "x@other.org", churchName: "Redemption House", answers: answers("Redemption House") }),
  app({ id: "b" }),
], ctx);
check("best match chosen", best?.applicationId === "b");
check("identity match beats a higher-scoring name-only match", bestApplicationMatch([app({ id: "n" }), app({ id: "i", contactEmail: "tech@gracechapel.org" })], ctx)?.identityMatched === true);
check("no candidates → null", bestApplicationMatch([], ctx) === null);
check("malformed rows skipped", bestApplicationMatch([null, 7, { id: 3 }] as unknown as ApplicationRow[], ctx) === null);
check("invalid createdAt tolerated", bestApplicationMatch([app({ createdAt: "not-a-date" })], ctx)?.applicationId === app().id);

// ── profile sanitizer ──
const p = sanitizeProfile({ desk: " Yamaha TF ", os: "linux", connection: "ndi", mixType: "aux", evil: 1, __proto__: { polluted: true }, failedRoutes: [{ connection: "usb-desk", reason: "no signal" }, { connection: "bogus", reason: "x" }, { bad: true }], corrections: [{ field: "desk", from: "X32", to: "Yamaha TF" }, { field: "__proto__", to: "x" }], completedAt: Infinity });
check("sanitize keeps valid", p.desk === "Yamaha TF" && p.connection === "ndi" && p.mixType === "aux");
check("sanitize drops invalid os + unknown keys", p.os === undefined && !("evil" in p));
check("no prototype pollution", ({} as Record<string, unknown>).polluted === undefined);
check("sanitize filters unknown connections in failedRoutes", p.failedRoutes?.length === 1);
check("sanitize filters unknown correction fields", p.corrections?.length === 1);
check("sanitize drops non-finite completedAt", p.completedAt === undefined);
check("sanitize non-object", Object.keys(sanitizeProfile("x")).length === 0);
check("failedRoutes at defaults to a finite number", Number.isFinite(sanitizeProfile({ failedRoutes: [{ connection: "ndi", reason: "r", at: Infinity }] }).failedRoutes![0].at));

// ── missing-table detection (raw + drizzle-wrapped) ──
check("raw postgres error detected", isMissingProfilesTable(Object.assign(new Error('relation "church_audio_profiles" does not exist'), { code: "42P01" })));
check("wrapped drizzle error detected", isMissingProfilesTable(Object.assign(new Error("Failed query: select ... from church_audio_profiles"), { cause: { code: "42P01", message: "x" } })));
check("unrelated error not swallowed", !isMissingProfilesTable(new Error("connection refused")));

console.log(`audio-application-match: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
