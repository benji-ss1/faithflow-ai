import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches, users } from "@/lib/db/schema";
import { AppShell } from "@/components/layout/AppShell";
import { TourGate } from "@/components/tutorial/TourGate";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = getDb();
  const [church] = await db.select({ name: churches.name }).from(churches).where(eq(churches.id, user.churchId)).limit(1);
  const [me] = await db.select({ tutorialCompletedAt: users.tutorialCompletedAt }).from(users).where(eq(users.id, user.id)).limit(1);
  const showTour = !me?.tutorialCompletedAt;
  return (
    <div className="min-h-screen bg-background">
      <AppShell user={{ name: user.name, email: user.email }} churchName={church?.name || "FaithFlow Church"}>
        {children}
      </AppShell>
      <TourGate show={showTour} />
    </div>
  );
}
