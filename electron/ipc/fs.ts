import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";

const MAX_INLINE_BYTES = 50 * 1024 * 1024;

// Session-scoped allowlist. Populated whenever the user picks a file or
// directory via native dialogs, or drag-drops content onto the renderer (see
// dialog.ts for the authorize call). Renderer JS therefore cannot ask fs to
// read arbitrary paths on disk — it can only read paths the user explicitly
// selected in this session. Cleared on app quit implicitly (module scope).
const allowedPaths = new Set<string>();
const allowedDirs = new Set<string>();

export function authorizePath(p: string) {
  if (typeof p !== "string" || !p) return;
  allowedPaths.add(path.resolve(p));
}

export function authorizeDir(p: string) {
  if (typeof p !== "string" || !p) return;
  allowedDirs.add(path.resolve(p));
}

function isPathAuthorized(target: string): boolean {
  const resolved = path.resolve(target);
  if (allowedPaths.has(resolved)) return true;
  for (const dir of allowedDirs) {
    const rel = path.relative(dir, resolved);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

function isDirAuthorized(target: string): boolean {
  const resolved = path.resolve(target);
  if (allowedDirs.has(resolved)) return true;
  for (const dir of allowedDirs) {
    const rel = path.relative(dir, resolved);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

export function registerFsIpc() {
  ipcMain.handle(
    "fs:readDirRecursive",
    async (_e, { dirPath, extensions }: { dirPath: string; extensions: string[] }) => {
      if (typeof dirPath !== "string" || !isDirAuthorized(dirPath)) {
        return { ok: false, error: "path not authorized", entries: [] };
      }
      const normExts = (extensions || []).map((e) =>
        e.startsWith(".") ? e.toLowerCase() : "." + e.toLowerCase()
      );
      const out: Array<{ absPath: string; relPath: string; size: number; ext: string }> = [];
      // Bound the traversal to prevent a maliciously deep or self-symlinked
      // directory tree from exhausting file descriptors or looping forever.
      const MAX_DEPTH = 12;
      const MAX_ENTRIES = 50_000;
      const visited = new Set<string>();
      async function walk(current: string, depth: number) {
        if (depth > MAX_DEPTH) return;
        if (out.length >= MAX_ENTRIES) return;
        // Realpath dedupe — follows symlinks once at most. Bare readdir on
        // a symlink loop would recurse until FD exhaustion.
        let real: string;
        try { real = await fs.promises.realpath(current); } catch { return; }
        if (visited.has(real)) return;
        visited.add(real);
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(current, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          if (out.length >= MAX_ENTRIES) return;
          const abs = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(abs, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (normExts.length === 0 || normExts.includes(ext)) {
              try {
                const stat = await fs.promises.stat(abs);
                out.push({
                  absPath: abs,
                  relPath: path.relative(dirPath, abs),
                  size: stat.size,
                  ext,
                });
              } catch {}
            }
          }
        }
      }
      await walk(dirPath, 0);
      return out;
    }
  );

  ipcMain.handle("fs:readFile", async (_e, { filePath }: { filePath: string }) => {
    if (typeof filePath !== "string" || !isPathAuthorized(filePath)) {
      return { ok: false, error: "path not authorized" };
    }
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_INLINE_BYTES) {
      return {
        tooLarge: true,
        size: stat.size,
        error: `File exceeds ${MAX_INLINE_BYTES} bytes; chunked read not yet implemented`,
      };
    }
    const buf = await fs.promises.readFile(filePath);
    return {
      tooLarge: false,
      size: stat.size,
      base64: buf.toString("base64"),
      name: path.basename(filePath),
      ext: path.extname(filePath).toLowerCase(),
    };
  });
}
