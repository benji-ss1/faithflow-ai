/** Safely replay every durable beta application to PresentFlow Ops. */
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { betaApplications } from "@/lib/db/schema";
import { deliverBetaApplicationToOps, type BetaApplicationAnswer } from "@/lib/ops-beta-webhook";

async function main() {
  const rows = await getDb().select({ id: betaApplications.id, churchName: betaApplications.churchName, contactEmail: betaApplications.contactEmail, answers: betaApplications.answers }).from(betaApplications).orderBy(desc(betaApplications.createdAt));
  for (const row of rows) {
    const answers: BetaApplicationAnswer[] = Array.isArray(row.answers) ? row.answers.filter((item): item is BetaApplicationAnswer => !!item && typeof item === "object" && typeof item.question === "string" && typeof item.answer === "string") : [];
    await deliverBetaApplicationToOps({ ...row, answers });
  }
  console.log(`Replayed ${rows.length} beta applications to PresentFlow Ops.`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
