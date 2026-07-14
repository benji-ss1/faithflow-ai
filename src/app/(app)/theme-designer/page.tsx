import Link from "next/link";
import { Palette } from "lucide-react";

/**
 * Theme Designer placeholder page.
 *
 * Full drag-and-drop slide-canvas editor is a significant build — deferred
 * from this pass (see DECISIONS.md — "Theme Designer deferred to a follow-up
 * loop"). For now, this page renders a friendly "coming soon" hero that
 * points operators back to the existing Themes tab in the operator shell.
 */
export default function ThemeDesignerPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#141a1a" }}>
      <div className="max-w-[560px] w-full text-center space-y-6 p-10 rounded-2xl border" style={{ background: "#1e2525", borderColor: "#2a3232" }}>
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full" style={{ background: "rgba(249,115,22,0.15)" }}>
          <Palette className="w-7 h-7 text-orange-400" />
        </div>
        <div>
          <h1 className="text-[22px] font-semibold text-zinc-100">Theme Designer is coming</h1>
          <p className="mt-2 text-[13px] text-zinc-400 leading-relaxed">
            A full slide-canvas editor with text, background, and layout inspectors is on the way.
            For now, use the <span className="text-zinc-200 font-medium">Themes</span> tab in the
            operator shell to apply and preview themes.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/operator"
            className="h-10 px-5 rounded-md text-[12px] font-semibold text-white inline-flex items-center justify-center"
            style={{ background: "#f97316" }}
          >
            Back to operator
          </Link>
          <Link
            href="/dashboard"
            className="h-10 px-5 rounded-md text-[12px] font-semibold text-zinc-200 border inline-flex items-center justify-center hover:bg-white/5"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
