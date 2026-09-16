/**
 * Replays every durable beta application to PresentFlow Ops.
 *
 * Run only with production-only env vars loaded. The Ops endpoint is signed
 * and uses the application UUID as its idempotency key, so the command is safe
 * to resume after a timeout and safe to run again after the live sender ships.
 */
import { desc } from "drizzle-orm";
import { deliverApplicationToOps } from "@/app/actions/apply";
import { getDb } from "@/lib/db/client";
import { betaApplications } from "@/lib/db/schema";

async function main() {
  const rows = await getDb()
    .select({
      id: betaApplications.id,
      answers: betaApplications.answers,
    })
    .from(betaApplications)
    .orderBy(desc(betaApplications.createdAt));

  // Deliberately NOT selecting the stored churchName/contactEmail columns:
  // deliverApplicationToOps derives identity from `answers` itself, because
  // several rows saved before 2026-08-23 have a mixer/soundboard model sitting
  // in their church_name column, not a real church name.
  for (const row of rows) {
    const answers = Array.isArray(row.answers)
      ? row.answers.filter((item): item is { question: string; answer: string } =>
          !!item && typeof item === "object" && typeof item.question === "string" && typeof item.answer === "string",
        )
      : [];
    await deliverApplicationToOps({ id: row.id, answers });
  }
  console.log(`Replayed ${rows.length} beta applications to PresentFlow Ops.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
