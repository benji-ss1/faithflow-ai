import "dotenv/config";
import bcrypt from "bcryptjs";
import { getDb } from "../src/lib/db/client";
import { churches, users, songs, songSlides, servicePlans, serviceItems, settings } from "../src/lib/db/schema";

async function main() {
  const db = getDb();
  const [church] = await db.insert(churches).values({ name: "Demo Church" }).returning();
  await db.insert(settings).values({ churchId: church.id });
  const passwordHash = await bcrypt.hash("operator123", 12);
  await db.insert(users).values({
    churchId: church.id,
    email: "operator@demo.church",
    passwordHash,
    name: "Sunday Operator",
    role: "operator",
  });

  const [song] = await db.insert(songs).values({ churchId: church.id, title: "Amazing Grace", artist: "John Newton" }).returning();
  await db.insert(songSlides).values([
    { songId: song.id, order: 0, lyrics: "Amazing grace! how sweet the sound\nThat saved a wretch like me!" },
    { songId: song.id, order: 1, lyrics: "I once was lost, but now am found;\nWas blind, but now I see." },
    { songId: song.id, order: 2, lyrics: "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;" },
  ]);

  const [plan] = await db.insert(servicePlans).values({ churchId: church.id, title: "Sunday Morning Service" }).returning();
  await db.insert(serviceItems).values([
    { servicePlanId: plan.id, order: 0, type: "logo", title: "Welcome", payload: {} },
    { servicePlanId: plan.id, order: 1, type: "song", title: "Amazing Grace", payload: { songId: song.id } },
    { servicePlanId: plan.id, order: 2, type: "scripture", title: "John 3:16", payload: { reference: "John 3:16", slides: [{ text: "For God so loved the world..." }] } },
    { servicePlanId: plan.id, order: 3, type: "blank", title: "Prayer", payload: {} },
  ]);

  console.log("✓ Seeded. Login: operator@demo.church / operator123");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
