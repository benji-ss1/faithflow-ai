/**
 * applicationMatch — Sarah audio setup (2026-09-15, hardened after review)
 * -------------------------------------------------------------------------
 * Decides whether a public beta application belongs to the signed-in church,
 * using MULTIPLE signals (the applicant is often not the Sunday operator, so
 * email alone is unreliable). Pure + deterministic.
 *
 * PRIVACY: beta_applications is NOT church-scoped. A church-name similarity is
 * guessable (a church can simply call itself "Grace"), so the application's
 * details (desk, device, applicant, city …) are only released when an IDENTITY
 * signal ties it to this church's own team: same email, a verified team
 * member's email, or the church's own (non-free-mail) email domain. A name-only
 * match returns the church name alone, as a "possible" to confirm.
 *
 * Output confidence:
 *   high     — identity signal + no church-name conflict ("I found your application")
 *   possible — something matched but not enough ("Is this your church?")
 *   none     — start fresh
 */

export type ApplicationAnswer = { question: string; answer: string };

export interface ApplicationRow {
  id: string;
  churchName: string | null;
  contactEmail: string | null;
  answers: ApplicationAnswer[];
  createdAt?: Date | string;
}

export interface ChurchContext {
  userEmail: string;
  userName?: string;
  /** Emails of VERIFIED members of this church (the caller filters). */
  memberEmails: string[];
  churchName: string;
  city?: string | null;
  country?: string | null;
}

export interface ExtractedSetup {
  churchName?: string;
  city?: string;
  country?: string;
  applicantName?: string;
  desk?: string;
  device?: string;
  currentSoftware?: string;
}

export type MatchSignal = { key: string; label: string; strength: "strong" | "support"; matched: boolean };

export interface ApplicationMatch {
  applicationId: string;
  confidence: "high" | "possible" | "none";
  score: number;
  /** True only when an identity signal (email / team email / church domain) matched. */
  identityMatched: boolean;
  signals: MatchSignal[];
  /** Redacted to { churchName } unless identityMatched. */
  setup: ExtractedSetup;
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk",
  "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "ymail.com",
]);
const CHURCH_STOPWORDS = new Set([
  "the", "of", "and", "a", "church", "chapel", "ministries", "ministry", "international", "intl", "assembly",
  "parish", "centre", "center", "cathedral", "fellowship", "rccg", "redeemed", "christian", "house", "god",
  "global", "worldwide", "mission", "gospel", "evangelical", "baptist", "pentecostal", "family", "de", "la", "le",
]);

/** Lowercase, strip accents (NFKD + remove combining marks), keep letters/digits/@/./space. */
export const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}@.\s-]/gu, " ").replace(/\s+/g, " ").trim();
const domainOf = (email: string | null | undefined) => { const m = /@([^@\s]+)$/.exec(norm(email)); return m ? m[1] : ""; };

function tokens(name: string | null | undefined, drop: Set<string> = new Set()): string[] {
  return [...new Set(norm(name).split(/[\s-]+/).filter((t) => t.length > 1 && !CHURCH_STOPWORDS.has(t) && !drop.has(t)))];
}

/**
 * Overlap of DISTINCTIVE tokens, measured against the LARGER set (0..1). When either
 * name has a single distinctive token the sets must be identical — one shared common
 * word ("Grace", "Life") is not a match on its own. Location tokens are ignored.
 */
export function churchNameSimilarity(a: string | null | undefined, b: string | null | undefined, ignore: string[] = []): number {
  const drop = new Set(ignore.flatMap((x) => norm(x).split(/[\s-]+/)).filter(Boolean));
  const ta = tokens(a, drop); const tb = tokens(b, drop);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  if (Math.min(ta.length, tb.length) === 1) return ta.length === tb.length && inter === 1 ? 1 : inter > 0 ? 0.4 : 0;
  return inter / Math.max(ta.length, tb.length);
}

function hasDistinctiveTokens(name: string | null | undefined, ignore: string[] = []): boolean {
  const drop = new Set(ignore.flatMap((x) => norm(x).split(/[\s-]+/)).filter(Boolean));
  return tokens(name, drop).length > 0;
}

function answerFor(answers: ApplicationAnswer[], re: RegExp): string | undefined {
  const hit = answers.find((a) => re.test(a.question ?? ""));
  const v = typeof hit?.answer === "string" ? hit.answer.trim() : "";
  return v ? v.slice(0, 200) : undefined;
}

function field(composite: string | undefined, key: string): string | undefined {
  if (!composite) return undefined;
  const m = new RegExp(`${key}\\s*:\\s*([^·—\\n|]+)`, "i").exec(composite);
  return m?.[1]?.trim() || undefined;
}

export function extractSetup(app: ApplicationRow): ExtractedSetup {
  const a = (Array.isArray(app?.answers) ? app.answers : [])
    .filter((x): x is ApplicationAnswer => !!x && typeof x === "object" && typeof (x as ApplicationAnswer).question === "string");
  const basics = answerFor(a, /church called|church name/i);
  const nameAns = answerFor(a, /your name/i);
  const first = field(nameAns, "first name"); const last = field(nameAns, "last name");
  return {
    churchName: (typeof app?.churchName === "string" && app.churchName) || field(basics, "church name") || undefined,
    city: field(basics, "city"),
    country: field(basics, "country"),
    applicantName: [first, last].filter(Boolean).join(" ") || undefined,
    desk: answerFor(a, /soundboard|mixer/i),
    device: answerFor(a, /device runs/i),
    currentSoftware: answerFor(a, /run today/i),
  };
}

export function scoreApplication(app: ApplicationRow, ctx: ChurchContext): ApplicationMatch {
  const full = extractSetup(app);
  const appEmail = norm(app.contactEmail);
  const members = new Set([ctx.userEmail, ...ctx.memberEmails].map(norm).filter(Boolean));
  const appDomain = domainOf(app.contactEmail);
  const churchDomains = new Set([...members].map(domainOf).filter((d) => d && !FREE_MAIL.has(d)));
  const locations = [ctx.city ?? "", ctx.country ?? "", full.city ?? "", full.country ?? ""];
  const nameSim = churchNameSimilarity(full.churchName, ctx.churchName, locations);

  const signals: MatchSignal[] = [
    { key: "email-user", label: "Same email as you", strength: "strong", matched: !!appEmail && appEmail === norm(ctx.userEmail) },
    { key: "email-member", label: "Applicant is on your church team", strength: "strong", matched: !!appEmail && appEmail !== norm(ctx.userEmail) && members.has(appEmail) },
    { key: "domain", label: "Same church email domain", strength: "strong", matched: !!appDomain && !FREE_MAIL.has(appDomain) && churchDomains.has(appDomain) },
    { key: "church-name", label: "Church name matches", strength: "strong", matched: nameSim >= 0.6 },
    { key: "city", label: "Same city", strength: "support", matched: !!full.city && !!ctx.city && norm(full.city).split(/[\s,]+/)[0] === norm(ctx.city).split(/[\s,]+/)[0] },
    { key: "country", label: "Same country", strength: "support", matched: !!full.country && !!ctx.country && norm(full.country) === norm(ctx.country) },
    { key: "applicant-name", label: "Applicant name matches you", strength: "support", matched: !!full.applicantName && !!ctx.userName && tokens(full.applicantName).some((t) => tokens(ctx.userName).includes(t)) },
  ];

  const w: Record<string, number> = { "email-user": 60, "email-member": 50, domain: 35, "church-name": 40, city: 12, country: 6, "applicant-name": 10 };
  const on = (k: string) => signals.find((x) => x.key === k)!.matched;
  const score = signals.reduce((s, x) => s + (x.matched ? w[x.key] : 0), 0);
  const identityMatched = on("email-user") || on("email-member") || on("domain");
  // Conflict only when BOTH names carry distinctive words and none are shared.
  const nameConflict = hasDistinctiveTokens(full.churchName, locations) && hasDistinctiveTokens(ctx.churchName, locations) && nameSim === 0;

  let confidence: ApplicationMatch["confidence"] = "none";
  if (identityMatched && !nameConflict) confidence = "high";
  else if (identityMatched || on("church-name")) confidence = "possible";

  const setup: ExtractedSetup = identityMatched ? full : { churchName: full.churchName };
  return { applicationId: app.id, confidence, score: nameConflict ? Math.min(score, 45) : score, identityMatched, signals, setup };
}

/** Best candidate; ties broken by newest application. Malformed rows are skipped. */
export function bestApplicationMatch(apps: ApplicationRow[], ctx: ChurchContext): ApplicationMatch | null {
  let best: { m: ApplicationMatch; t: number } | null = null;
  for (const app of Array.isArray(apps) ? apps : []) {
    if (!app || typeof app !== "object" || typeof app.id !== "string") continue;
    const m = scoreApplication(app, ctx);
    if (m.confidence === "none") continue;
    const rank = (x: ApplicationMatch) => (x.confidence === "high" ? 1000 : 0) + x.score;
    const tRaw = app.createdAt ? new Date(app.createdAt).getTime() : 0;
    const t = Number.isFinite(tRaw) ? tRaw : 0;
    if (!best || rank(m) > rank(best.m) || (rank(m) === rank(best.m) && t > best.t)) best = { m, t };
  }
  return best?.m ?? null;
}
