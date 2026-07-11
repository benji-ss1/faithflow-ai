import { requireUser } from "@/lib/session";
import { DiagnosticsPanel } from "@/components/setup/DiagnosticsPanel";
import { PageHeader } from "@/components/layout/PageHeader";

/**
 * Install-time diagnostics.
 * Verifies each infrastructure dependency reachable from THIS browser:
 *   - App HTTP (self)
 *   - Database (via /api/health-db)
 *   - Storage (via /api/health-storage)
 *   - Audio bridge WebSocket (wss:// upgrade handshake)
 *   - Groq AI helpers (auth-gated endpoint returns a 200 or MISSING_API_KEY)
 *   - Realtime channel (if Supabase URL configured)
 */
export default async function DiagnosticsPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Install diagnostics"
        description="One-shot health check across every service FaithFlow depends on."
      />
      <DiagnosticsPanel />
    </div>
  );
}
