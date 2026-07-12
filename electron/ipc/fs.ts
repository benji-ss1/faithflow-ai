import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";

const MAX_INLINE_BYTES = 50 * 1024 * 1024;

export function registerFsIpc() {
  ipcMain.handle(
    "fs:readDirRecursive",
    async (_e, { dirPath, extensions }: { dirPath: string; extensions: string[] }) => {
      const normExts = (extensions || []).map((e) =>
        e.startsWith(".") ? e.toLowerCase() : "." + e.toLowerCase()
      );
      const out: Array<{ absPath: string; relPath: string; size: number; ext: string }> = [];
      async function walk(current: string) {
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(current, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          const abs = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(abs);
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
      await walk(dirPath);
      return out;
    }
  );

  ipcMain.handle("fs:readFile", async (_e, { filePath }: { filePath: string }) => {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_INLINE_BYTES) {
      // Return metadata + refuse; caller should switch to chunked path (not implemented yet)
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
