import Link from "next/link";
import { Home } from "lucide-react";

// Global 404. Blueprint-grid backdrop with a hollow, dashed-outline "404" in
// the PresentFlow brand orange (adapted from the reference design, kept on
// brand rather than the reference green). Server component — the only
// interactive element is a plain link home.
export default function NotFound() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "#0a0a0c" }}>
      {/* Faint blueprint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(#ffffff08 1px, transparent 1px), linear-gradient(90deg, #ffffff08 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 45%, #000 55%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 45%, #000 55%, transparent 100%)",
        }}
      />
      <div className="relative flex flex-col items-center">
        <h1
          className="font-black leading-none select-none"
          style={{
            fontSize: "clamp(120px, 26vw, 300px)",
            color: "#e8501a14",
            WebkitTextStroke: "2px #e8501a",
            letterSpacing: "0.02em",
          }}
        >
          404
        </h1>
        <p className="mt-4 text-2xl sm:text-3xl font-bold text-white">No, no, that&apos;s right.</p>
        <p className="mt-3 max-w-md text-[15px] sm:text-base leading-relaxed text-white/55">
          This is a 404 page. And this page exists, no matter what anyone says.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 h-12 px-6 rounded-xl text-[15px] font-bold transition-[filter] hover:brightness-110"
          style={{ background: "#e8501a", color: "#0b0b0e" }}
        >
          Go Back Home <Home className="w-4 h-4" />
        </Link>
      </div>
    </main>
  );
}
