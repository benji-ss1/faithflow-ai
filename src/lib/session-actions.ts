"use server";

import { signOut } from "./auth";
import { requireUser } from "./session";
import { revokeAllSessionsForUser } from "./session-revocation";

/** "Sign out all devices" — scoped to the signed-in user only (never takes a userId). */
export async function signOutAllDevices(): Promise<void> {
  const user = await requireUser();
  await revokeAllSessionsForUser(user.id);
  await signOut({ redirectTo: "/login?reason=signed_out_all" });
}
