// LAN overlay server — a tiny http + WebSocket server the desktop app runs on
// the operator machine so an OBS Browser Source on a SEPARATE broadcast PC can
// receive live lyrics/scripture over the LOCAL NETWORK, with no dependency on
// the cloud (Supabase Realtime) round-trip.
//
// Why this exists (design notes):
//  - The cloud path (Supabase Realtime, `?pair=CODE`) works but depends on the
//    internet being up AND on a third-party fan-out that can lag or drop under a
//    flaky church network. On a busy Sunday that's the least-reliable path.
//  - LAN is a direct, same-network WebSocket: near-zero latency, no external
//    dependency, and it snapshots the current slide the instant OBS connects so
//    the overlay never stares at a blank/stale frame.
//  - The overlay PAGE is the EXISTING /livestream React page — we only swap the
//    TRANSPORT, so the theme/appearance render path is reused verbatim; whatever
//    fixes the projector fixes the LAN overlay too. OBS points at:
//      http://<operator-lan-ip>:<port>/livestream?bg=transparent&lan=<ip>:<port>
//    and /livestream opens ws://<ip>:<port>/ws instead of Supabase.
//  - Serving the page over http from THIS origin is deliberate and necessary:
//    a page served over https CANNOT open an insecure ws:// LAN socket (Chromium
//    mixed-content block), and an enforced CSP `connect-src 'self'` would reject
//    a cross-origin ws too. Same-origin http page + ws://same-origin sidesteps
//    both. We serve the real page by REVERSE-PROXYING every non-/ws request to
//    the hosted app origin (appOrigin) — so `/_next/...`, RSC, everything comes
//    straight from the deployed build; no renderer is duplicated here. (Loading
//    the page still needs internet, but the LIVE DATA path is pure LAN — that's
//    the reliability/latency win over Supabase Realtime.)
//
// Security posture:
//  - Bind to 0.0.0.0 but this is a read-only, same-LAN broadcast of what's
//    already on the projector. No auth beyond being on the network (mirrors the
//    pair-code trust model: on the network == trusted, same as the projector).
//  - Payloads are validated shape-wise before broadcast (never trust a client);
//    clients can only RECEIVE — inbound ws messages are ignored except a
//    snapshot request.
//  - Windows firewall: best-effort scoped rule (private profile, local subnet
//    only). If elevation isn't available the rule silently fails and Windows may
//    prompt on first bind; the UI tells the operator how to allow it.

import * as http from "http";
import * as os from "os";
import { WebSocketServer, WebSocket } from "ws";
import { exec } from "child_process";

export type LanServerInfo = {
  running: boolean;
  ip: string | null;
  port: number | null;
  clients: number;
};

const DEFAULT_PORT = 7590;
const PORT_TRIES = 8; // 7590..7597

/** Pick the best private LAN IPv4 (192.168.x / 10.x / 172.16-31.x), non-internal. */
function pickLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      candidates.push(ni.address);
    }
  }
  // Prefer 192.168.* (typical home/church router), then 10.*, then anything.
  const byPref = (a: string) =>
    a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3;
  candidates.sort((a, b) => byPref(a) - byPref(b));
  return candidates[0] ?? null;
}

/** Only private/loopback peers may talk to the server — defense-in-depth on top
 * of binding to the LAN IP, so even a mis-scoped network can't expose it to a
 * routable/public host. Accepts IPv4 private ranges + loopback + IPv6 ULA/link-
 * local/loopback (incl. IPv4-mapped forms). */
function isPrivateRemote(addr: string | undefined): boolean {
  if (!addr) return false;
  let a = addr.trim().toLowerCase();
  if (a.startsWith("::ffff:")) a = a.slice(7); // IPv4-mapped IPv6
  if (a === "::1" || a === "127.0.0.1") return true;
  if (a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80:")) return true; // ULA / link-local
  if (a.startsWith("10.") || a.startsWith("192.168.") || a.startsWith("127.")) return true;
  const m = /^172\.(\d{1,3})\./.exec(a);
  if (m) { const o = Number(m[1]); if (o >= 16 && o <= 31) return true; }
  return false;
}

const MAX_RESP_BYTES = 32 * 1024 * 1024; // 32 MB cap on a proxied asset
const UPSTREAM_TIMEOUT_MS = 15_000;

/** Minimal structural validation — must have a `live` slide object. Mirrors the
 * renderer's isValidOutputStateExternal contract loosely (main can't import the
 * renderer's schema). We never render this in main; we only relay it. */
function looksLikeOutputState(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return "live" in s && typeof s.live === "object";
}

export class LanOverlayServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number | null = null;
  private ip: string | null = null;
  private lastState: unknown = null;
  private firewallPort: number | null = null; // port the firewall rule was added for
  private appOrigin = "https://presentflow.org";

  isRunning(): boolean {
    return !!this.server && !!this.wss;
  }

  info(): LanServerInfo {
    return {
      running: this.isRunning(),
      ip: this.ip,
      port: this.port,
      clients: this.wss ? this.wss.clients.size : 0,
    };
  }

  /** Start on the first free port in the range. Idempotent — returns current
   * info if already running. `appOrigin` is the hosted app URL that non-/ws
   * requests are reverse-proxied to (so the real /livestream page is served
   * over this http origin). */
  async start(appOrigin?: string, preferredPort?: number): Promise<LanServerInfo> {
    if (appOrigin && /^https?:\/\//.test(appOrigin)) this.appOrigin = appOrigin.replace(/\/$/, "");
    if (this.isRunning()) return this.info();
    this.ip = pickLanIp();
    // Prefer the caller's port, else the port we last bound (so a stop→start
    // keeps the same URL the operator already pasted into OBS), else default.
    const base = preferredPort && preferredPort > 0 ? preferredPort : (this.port ?? DEFAULT_PORT);
    let lastErr: unknown = null;
    for (let i = 0; i < PORT_TRIES; i++) {
      const tryPort = base + i;
      try {
        await this.listenOn(tryPort);
        this.port = tryPort;
        this.tryOpenFirewall(tryPort);
        // eslint-disable-next-line no-console
        console.log(`[lan] overlay server listening on ${this.ip ?? "0.0.0.0"}:${tryPort}`);
        return this.info();
      } catch (e) {
        lastErr = e;
        // EADDRINUSE → try next port; anything else → bail.
        if ((e as NodeJS.ErrnoException)?.code !== "EADDRINUSE") break;
      }
    }
    console.warn("[lan] failed to start:", lastErr instanceof Error ? lastErr.message : String(lastErr));
    this.stop();
    return this.info();
  }

  private listenOn(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Assign this.server/this.wss ONLY on a successful listen — so a failed
      // bind (EADDRINUSE) doesn't leak a half-wired server that the retry then
      // overwrites without closing.
      const server = http.createServer((req, res) => {
        // Defense-in-depth: reject any non-private/routable peer even though we
        // bind to the LAN IP. Keeps a mis-scoped/public network from reaching in.
        if (!isPrivateRemote(req.socket.remoteAddress ?? undefined)) {
          res.writeHead(403, { "content-type": "text/plain" });
          res.end("forbidden");
          return;
        }
        // Local health/info endpoint (never proxied).
        if (req.url === "/__lan_health") {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end(
            `PresentFlow LAN overlay server is running.\n` +
              `Clients connected: ${this.wss ? this.wss.clients.size : 0}\n`,
          );
          return;
        }
        // Everything else → reverse-proxy to the hosted app so the REAL
        // /livestream page (and its /_next assets/RSC) is served over this http
        // origin, letting it open the same-origin ws:// LAN socket.
        this.proxyToApp(req, res).catch((e) => {
          try {
            res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
            res.end(`LAN overlay proxy error: ${e instanceof Error ? e.message : String(e)}`);
          } catch { /* response already sent */ }
        });
      });
      const wss = new WebSocketServer({ server, path: "/ws" });
      wss.on("connection", (socket: WebSocket, req: http.IncomingMessage) => {
        if (!isPrivateRemote(req.socket.remoteAddress ?? undefined)) {
          try { socket.close(); } catch { /* ignore */ }
          return;
        }
        // Snapshot-on-connect: OBS never stares at black — it gets the current
        // slide immediately.
        if (this.lastState != null) {
          try { socket.send(JSON.stringify({ type: "output", state: this.lastState })); } catch { /* ignore */ }
        }
        socket.on("message", (raw) => {
          // Clients are receive-only. The one thing we honour is an explicit
          // snapshot request (a late/reconnecting OBS asking for the frame).
          try {
            const msg = JSON.parse(String(raw));
            if (msg && msg.type === "snapshot_request" && this.lastState != null) {
              socket.send(JSON.stringify({ type: "output", state: this.lastState }));
            }
          } catch { /* ignore malformed */ }
        });
        socket.on("error", () => { /* ignore per-socket errors */ });
      });
      const onErr = (e: Error) => {
        // Close the failed pair so no listeners/handles leak before the retry.
        try { wss.close(); } catch { /* ignore */ }
        try { server.close(); } catch { /* ignore */ }
        reject(e);
      };
      server.once("error", onErr);
      // Bind to the specific LAN IP (not 0.0.0.0) so the listener is only on the
      // church network, never all interfaces. Fall back to 0.0.0.0 only if no
      // LAN IP was found (the remoteAddress gate above still restricts callers).
      server.listen(port, this.ip ?? "0.0.0.0", () => {
        server.removeListener("error", onErr);
        this.server = server;
        this.wss = wss;
        resolve();
      });
    });
  }

  /** Reverse-proxy a request to the hosted app origin and stream the response
   * back, so the real /livestream page is served over this http origin.
   *
   * Hardened (LAN peers are semi-trusted, not trusted — see the security review):
   *  - READ-ONLY: only GET/HEAD are proxied (an overlay never mutates state), so
   *    the proxy can't be used to drive state-changing POSTs (CSRF-via-no-Origin).
   *  - PATH ALLOWLIST: only the overlay page (/livestream), Next assets (/_next),
   *    and a few static files are reachable. /api/* and everything else → 403, so
   *    the proxy can't be used to reach app API routes at all.
   *  - TRUST-HEADER STRIP: x-pf-shell / authorization / cookie / x-forwarded-* are
   *    dropped, so a LAN host can't forge the "desktop shell" trust header the app
   *    middleware honours, or otherwise impersonate a privileged caller.
   *  - SIZE + TIMEOUT caps so a LAN host can't OOM/stall the operator PC mid-service. */
  private async proxyToApp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Only origin-form paths ("/...") are proxied. Reject absolute-URI /
    // authority-form request lines so a crafted request can't retarget the
    // proxy at another host (SSRF/open-proxy hardening — appOrigin is fixed).
    const rawUrl = req.url ?? "/";
    if (!rawUrl.startsWith("/")) { res.writeHead(400, { "content-type": "text/plain" }); res.end("bad request"); return; }

    // READ-ONLY: overlay only ever GETs (RSC included). Block everything else.
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") { res.writeHead(405, { "content-type": "text/plain" }); res.end("method not allowed"); return; }

    // PATH ALLOWLIST — only what the overlay page needs; never /api/*.
    const pathOnly = rawUrl.split("?")[0];
    const allowed =
      pathOnly === "/livestream" ||
      pathOnly.startsWith("/_next/") ||
      pathOnly === "/favicon.ico" ||
      pathOnly === "/manifest.json" ||
      pathOnly === "/manifest.webmanifest" ||
      pathOnly.startsWith("/icons/") ||
      pathOnly.startsWith("/fonts/") ||
      /\.(js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|ico|json|map)$/.test(pathOnly);
    if (!allowed) { res.writeHead(403, { "content-type": "text/plain" }); res.end("forbidden"); return; }

    const target = `${this.appOrigin}${rawUrl}`;
    // Forward a minimal, SAFE header set. Strip anything that establishes trust
    // or identity; force identity encoding so fetch's decoded body matches the
    // content-length we relay.
    const STRIP = new Set([
      "host", "connection", "accept-encoding", "cookie", "authorization",
      "x-pf-shell", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
      "x-real-ip", "forwarded", "referer", "origin",
    ]);
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      const lk = k.toLowerCase();
      if (STRIP.has(lk) || lk.startsWith("x-pf") || lk.startsWith("x-forwarded")) continue;
      outHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    outHeaders["accept-encoding"] = "identity";

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(target, { method, headers: outHeaders, redirect: "manual", signal: ctrl.signal });
    } finally { clearTimeout(to); }

    const raw = await upstream.arrayBuffer();
    if (raw.byteLength > MAX_RESP_BYTES) { res.writeHead(502, { "content-type": "text/plain" }); res.end("upstream response too large"); return; }
    const buf = Buffer.from(raw);
    const relay: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      // Drop hop-by-hop + length/encoding we recompute; drop HSTS (this origin
      // is http); drop set-cookie so no cookie is ever planted on the LAN origin.
      if (["content-encoding", "content-length", "transfer-encoding", "connection", "strict-transport-security", "set-cookie"].includes(lk)) return;
      relay[key] = value;
    });
    relay["content-length"] = String(buf.length);
    res.writeHead(upstream.status, relay);
    res.end(buf);
  }

  /** Fan a full OutputState frame out to every connected OBS overlay. Stores it
   * as the snapshot for future joiners. Called from the operator renderer via
   * IPC on every output change. */
  publish(state: unknown): void {
    if (!looksLikeOutputState(state)) return;
    this.lastState = state;
    if (!this.wss) return;
    const frame = JSON.stringify({ type: "output", state });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(frame); } catch { /* drop this client silently */ }
      }
    }
  }

  /** Await the underlying close so a stop→start can rebind the SAME port (the
   * URL the operator already pasted into OBS) instead of drifting to the next. */
  async stop(): Promise<void> {
    const wss = this.wss, server = this.server;
    this.wss = null;
    this.server = null;
    // keep this.port/this.ip/lastState so a restart reuses the same port + warms
    try { wss?.close(); } catch { /* ignore */ }
    if (server) {
      await new Promise<void>((resolve) => { try { server.close(() => resolve()); } catch { resolve(); } });
    }
  }

  /** Best-effort Windows firewall allow-rule, scoped as tightly as possible:
   * inbound TCP, this port only, PRIVATE profile only, local subnet only. Fails
   * silently without elevation — Windows may then prompt on first bind, or the
   * operator allows the app manually (the UI documents this). No-op off win32. */
  private tryOpenFirewall(port: number): void {
    // Add once PER PORT — if the bind drifted to a new port on restart, the new
    // port still gets its rule (a single latch would have skipped it).
    if (process.platform !== "win32" || !Number.isInteger(port) || this.firewallPort === port) return;
    this.firewallPort = port;
    const ruleName = `PresentFlow LAN Overlay ${port}`;
    const cmd =
      `netsh advfirewall firewall add rule name="${ruleName}" ` +
      `dir=in action=allow protocol=TCP localport=${port} profile=private remoteip=localsubnet`;
    exec(cmd, (err) => {
      if (err) {
        // Expected without admin — not fatal. Logged for support, not surfaced.
        console.warn("[lan] firewall rule not added (needs admin, non-fatal):", err.message);
      } else {
        console.log(`[lan] firewall rule added for port ${port} (private/localsubnet)`);
      }
    });
  }
}

// Singleton — one server per app instance.
let _server: LanOverlayServer | null = null;
export function getLanServer(): LanOverlayServer {
  if (!_server) _server = new LanOverlayServer();
  return _server;
}
