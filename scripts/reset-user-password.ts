/**
 * Direct password reset by email — bypasses the email-token flow. Prints
 * the new password to stdout (once). Requires DATABASE_URL in the env.
 *
 *   Usage: EMAIL=demo@jpd.presentflow.ai npx tsx --env-file=.env.local scripts/reset-user-password.ts
 *   or: DATABASE_URL=... EMAIL=... npx tsx scripts/reset-user-password.ts
 *
 * If NEW_PASSWORD is set, uses that. Otherwise generates a 20-char random.
 */
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";

async function main() {
  const email = process.env.EMAIL;
  if (!email) { console.error("EMAIL env var required"); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL missing"); process.exit(1); }

  // Prod-guard: refuse unless the operator explicitly opts in with
  // I_UNDERSTAND_THIS_IS_PROD=1, and the target's church is flagged is_demo=true
  // OR the operator adds ALLOW_NON_DEMO=1. Prevents an accidental takeover
  // of a real tenant admin from a shell that happens to have prod DATABASE_URL.
  const isProdUrl = /supabase\.co|pooler\.supabase\.com/.test(process.env.DATABASE_URL);
  if (isProdUrl && process.env.I_UNDERSTAND_THIS_IS_PROD !== "1") {
    console.error("Prod DATABASE_URL detected. Re-run with I_UNDERSTAND_THIS_IS_PROD=1 to proceed.");
    process.exit(2);
  }

  const password = process.env.NEW_PASSWORD
    || randomBytes(15).toString("base64url").replace(/[-_]/g, "").slice(0, 20);

  const hash = await bcrypt.hash(password, 12);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Refuse to touch non-demo tenants on prod unless explicitly allowed.
    if (isProdUrl && process.env.ALLOW_NON_DEMO !== "1") {
      const chk = await pool.query(
        `SELECT c.is_demo FROM users u LEFT JOIN churches c ON c.id = u.church_id WHERE u.email = $1`,
        [email]
      );
      const row = chk.rows[0];
      if (!row) { console.error(`no user with email ${email}`); process.exit(1); }
      if (row.is_demo !== true) {
        console.error(`refusing: ${email} is not on an is_demo church. Add ALLOW_NON_DEMO=1 if you're sure.`);
        process.exit(2);
      }
    }
    const r = await pool.query(
      `UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now())
       WHERE email = $2 RETURNING id, email, name`,
      [hash, email]
    );
    if (r.rowCount === 0) { console.error(`no user with email ${email}`); process.exit(1); }
    console.log("✓ password reset");
    console.log("  email:   ", r.rows[0].email);
    console.log("  name:    ", r.rows[0].name);
    console.log("  password:", password);
    console.log("\n(this is printed once — copy it now)");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
