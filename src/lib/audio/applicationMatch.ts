/**
 * applicationMatch — Sarah audio setup (2026-09-15)
 * -------------------------------------------------------------------------
 * Decides whether a public beta application belongs to the signed-in church,
 * using MULTIPLE signals (the applicant is often not the Sunday operator, so
 * email alone is unreliable). Pure + deterministic — the server loader feeds it
 * candidate rows; nothing here touches the DB.
 *
 * Output confidence:
 *   high     — "I found your application"
 *   possible — "Is this your church?" (must be confirmed before use)
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
  signals: MatchSignal[];
  setup: ExtractedSetup;
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk",
  "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "ymail.com",
]);
const CHURCH_STOPWORDS = new Set([
  "the", "of", "and", "church", "chapel", "ministries", "ministry", "international", "intl", "assembly",
  "parish", "centre", "center", "cathedral", "fellowship", "rccg", "redeemed", "christian", "house",
]);

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}@.\s-]/gu, " ").replace(/\s+/g, " ").trim();
const domainOf = (email: string | null | undefined) => { const m = /@([^@\s]+)$/.exec(norm(email)); return m ? m[1] : ""; };

function tokens(name: string | null | undefined): string[] {
  return norm(name).split(/[\s-]+/).filter((t) => t.length > 1 && !CHURCH_STOPWORDS.has(t));
}

/** Jaccard-ish overlap on distinctive tokens (0..1). "RCCG Grace Chapel" vs "Grace Chapel Lagos" → high. */
export function churchNameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(tokens(a)); const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

function answerFor(answers: ApplicationAnswer[], re: RegExp): string | undefined {
  const hit = answers.find((a) => re.test(a.question ?? ""));
  const v = hit?.answer?.trim();
  return v ? v.slice(0, 200) : undefined;
}

function field(composite: string | undefined, key: string): string | undefined {
  if (!composite) return undefined;
  const m = new RegExp(`${key}\\s*:\\s*([^·—\\n|]+)`, "i").exec(composite);
  return m?.[1]?.trim() || undefined;
}

export function extractSetup(app: ApplicationRow): ExtractedSetup {
  const a = Array.isArray(app.answers) ? app.answers : [];
  const basics = answerFor(a, /church called|church name/i);
  const nameAns = answerFor(a, /your name/i);
  const first = field(nameAns, "first name"); const last = field(nameAns, "last name");
  return {
    churchName: app.churchName ?? field(basics, "church name") ?? undefined,
    city: field(basics, "city"),
    country: field(basics, "country"),
    applicantName: [first, last].filter(Boolean).join(" ") || undefined,
    desk: answerFor(a, /soundboard|mixer/i),
    device: answerFor(a, /device runs/i),
    currentSoftware: answerFor(a, /run today/i),
  };
}

export function scoreApplication(app: ApplicationRow, ctx: ChurchContext): ApplicationMatch {
  const setup = extractSetup(app);
  const appEmail = norm(app.contactEmail);
  const members = new Set([ctx.userEmail, ...ctx.memberEmails].map(norm).filter(Boolean));
  const appDomain = domainOf(app.contactEmail);
  const churchDomains = new Set([...members].map(domainOf).filter((d) => d && !FREE_MAIL.has(d)));
  const nameSim = churchNameSimilarity(setup.churchName, ctx.churchName);

  const signals: MatchSignal[] = [
    { key: "email-user", label: "Same email as you", strength: "strong", matched: !!appEmail && appEmail === norm(ctx.userEmail) },
    { key: "email-member", label: "Applicant is on your church team", strength: "strong", matched: !!appEmail && appEmail !== norm(ctx.userEmail) && members.has(appEmail) },
    { key: "church-name", label: "Church name matches", strength: "strong", matched: nameSim >= 0.6 },
    { key: "domain", label: "Same church email domain", strength: "strong", matched: !!appDomain && !FREE_MAIL.has(appDomain) && churchDomains.has(appDomain) },
    { key: "city", label: "Same city", strength: "support", matched: !!setup.city && !!ctx.city && churchNameSimilarity(setup.city, ctx.city) >= 0.5 },
    { key: "country", label: "Same country", strength: "support", matched: !!setup.country && !!ctx.country && norm(setup.country) === norm(ctx.country) },
    { key: "applicant-name", label: "Applicant name matches you", strength: "support", matched: !!setup.applicantName && !!ctx.userName && churchNameSimilarity(setup.applicantName, ctx.userName) >= 0.5 },
  ];

  const w: Record<string, number> = { "email-user": 60, "email-member": 50, "church-name": 40, domain: 35, city: 12, country: 6, "applicant-name": 10 };
  const score = signals.reduce((s, x) => s + (x.matched ? w[x.key] : 0), 0);
  const strong = signals.filter((s) => s.strength === "strong" && s.matched).length;
  // Contradiction: a confidently DIFFERENT church name vetoes email-only matches (a volunteer
  // who applied for another church, or re-used a personal address).
  const nameConflict = !!setup.churchName && !!ctx.churchName && nameSim === 0;

  let confidence: ApplicationMatch["confidence"] = "none";
  if (!nameConflict && (strong >= 2 || (strong === 1 && score >= 60))) confidence = "high";
  else if (strong >= 1 || score >= 40) confidence = "possible";

  return { applicationId: app.id, confidence, score: nameConflict ? Math.min(score, 45) : score, signals, setup };
}

/** Best candidate; ties broken by newest application. */
export function bestApplicationMatch(apps: ApplicationRow[], ctx: ChurchContext): ApplicationMatch | null {
  let best: { m: ApplicationMatch; t: number } | null = null;
  for (const app of apps) {
    const m = scoreApplication(app, ctx);
    if (m.confidence === "none") continue;
    const t = app.createdAt ? new Date(app.createdAt).getTime() : 0;
    if (!best || m.score > best.m.score || (m.score === best.m.score && t > best.t)) best = { m, t };
  }
  return best?.m ?? null;
}
