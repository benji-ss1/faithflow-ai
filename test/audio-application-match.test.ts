// Sarah audio setup: beta-application matching uses multiple signals, never email alone.
import { scoreApplication, bestApplicationMatch, extractSetup, churchNameSimilarity, type ApplicationRow } from "../src/lib/audio/applicationMatch";
import { sanitizeProfile } from "../src/lib/server/audio-setup";

let passed = 0; let failed = 0;
function check(name: string, cond: boolean) { if (cond) passed++; else { failed++; console.error(`FAIL: ${name}`); } }

const answers = (church: string, desk = "Behringer X32", device = "Mac") => [
  { question: "What's your church called, and where?", answer: `Church name: ${church} · City: Lagos · Country: Nigeria` },
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

check("name similarity ignores RCCG/church stopwords", churchNameSimilarity("RCCG Grace Chapel", "Grace Chapel Lagos") >= 0.6);
check("different churches → 0", churchNameSimilarity("Redemption House", "Grace Chapel") === 0);

const s = extractSetup(app());
check("extract desk", s.desk === "Behringer X32");
check("extract device", s.device === "Mac");
check("extract city/country", s.city === "Lagos" && s.country === "Nigeria");
check("extract applicant", s.applicantName === "Samuel Ade");

// Operator differs from applicant, but church name + domain match → high
const m1 = scoreApplication(app(), ctx);
check("different email but name+domain → high", m1.confidence === "high");
check("signals list includes church-name matched", m1.signals.some((x) => x.key === "church-name" && x.matched));

// Gmail applicant, name + city match only → possible? name strong(40)+city(12)+country(6)=58, 1 strong <60 → possible
const m2 = scoreApplication(app({ contactEmail: "sam.ade@gmail.com" }), { ...ctx, userEmail: "ops@gmail.com", memberEmails: ["ops@gmail.com"] });
check("gmail applicant, name+city → possible (asks to confirm)", m2.confidence === "possible");
check("free-mail domains never count as domain match", !m2.signals.find((x) => x.key === "domain")!.matched);

// Same email as the user → high even if church name wording differs a bit
const m3 = scoreApplication(app({ contactEmail: "TECH@gracechapel.org" }), ctx);
check("case-insensitive same email → high", m3.confidence === "high");

// Applicant is a team member (pastor account) → strong
const m4 = scoreApplication(app({ contactEmail: "pastor@gmail.com" }), { ...ctx, memberEmails: ["tech@gracechapel.org", "pastor@gmail.com"] });
check("applicant on church team + name → high", m4.confidence === "high");

// Email matches but church name is a DIFFERENT church → never high
const m5 = scoreApplication(app({ contactEmail: "tech@gracechapel.org", churchName: "Redemption House", answers: answers("Redemption House") }), ctx);
check("name conflict vetoes high", m5.confidence !== "high");

// Nothing matches → none
const m6 = scoreApplication(app({ contactEmail: "x@other.org", churchName: "Redemption House", answers: answers("Redemption House") }), { ...ctx, city: "Accra", country: "Ghana" });
check("unrelated → none", m6.confidence === "none");

// best picks highest score, ignores none
const best = bestApplicationMatch([
  app({ id: "a", contactEmail: "x@other.org", churchName: "Redemption House", answers: answers("Redemption House") }),
  app({ id: "b" }),
], ctx);
check("best match chosen", best?.applicationId === "b");
check("no candidates → null", bestApplicationMatch([], ctx) === null);
check("hostile answers shape tolerated", scoreApplication(app({ answers: null as unknown as [] }), ctx).setup.desk === undefined);

// profile sanitizer
const p = sanitizeProfile({ desk: " Yamaha TF ", os: "linux", connection: "ndi", mixType: "aux", evil: 1, failedRoutes: [{ connection: "usb-desk", reason: "no signal on 15/16" }, { bad: true }], corrections: [{ field: "desk", from: "X32", to: "Yamaha TF" }] });
check("sanitize keeps valid", p.desk === "Yamaha TF" && p.connection === "ndi" && p.mixType === "aux");
check("sanitize drops invalid os + unknown keys", p.os === undefined && !("evil" in p));
check("sanitize failed routes filtered", p.failedRoutes?.length === 1);
check("sanitize corrections", p.corrections?.[0]?.to === "Yamaha TF");
check("sanitize non-object", Object.keys(sanitizeProfile("x")).length === 0);

console.log(`audio-application-match: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
