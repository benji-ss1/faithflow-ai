import type { NextConfig } from "next";

// Global security headers. Applied to every response via Next headers()
// hook. Kept modest so features that legitimately need it (Deepgram WSS,
// Supabase API, Stripe, GitHub Releases updater) aren't broken.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
  // HSTS: force HTTPS for the domain + subdomains for a year. Only sent on
  // https responses (browsers ignore on http anyway).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
    ];
  },
  // Keep native / heavy Node-only modules out of the webpack graph entirely.
  // Any of these landing in a client bundle would trigger `.node` binary
  // parse errors or explode bundle size. All are used only from server-side
  // paths (API routes, server actions, background scripts).
  serverExternalPackages: [
    "@napi-rs/canvas",       // PPTX → PNG conversion (native skia binary)
    "libreoffice-convert",   // spawns soffice, uses tmp files
    "pdfjs-dist",            // legacy Node build, canvas-dependent
    "@xenova/transformers",  // ONNX runtime, ~90MB model + native ops
    "@deepgram/sdk",         // ws + custom transport, imported only by scripts/audio-server
    "sharp",                 // pulled transitively by some upload paths
    "ws",                    // Node WS server for audio bridge
    "adm-zip",               // reads folder-as-ZIP for bulk imports
  ],
};

export default nextConfig;
