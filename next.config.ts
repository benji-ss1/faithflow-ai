import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
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
