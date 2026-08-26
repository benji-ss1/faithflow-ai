import { apiUser } from "@/lib/session";
import { getChurchGreeting } from "@/lib/server/openflow-context";
import { isOpenFlowConfigured } from "@/lib/server/openflow";

export const runtime = "nodejs";

/** Minimal context for the OpenFlow welcome screen: the church's name, a
 *  time-of-day greeting, and whether OpenFlow is actually configured (so the
 *  welcome can say so plainly instead of looking alive while every message
 *  would 503). churchId is authoritative from the session. */
export async function GET() {
  const user = await apiUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  const info = await getChurchGreeting(user.churchId);
  return new Response(JSON.stringify({ ...info, configured: isOpenFlowConfigured() }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
