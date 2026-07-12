"use client";

/**
 * Electron-only file/folder pickers. Render nothing when not running inside the
 * Electron desktop shell (so the browser build is unaffected).
 *
 * Usage:
 *   <ElectronPickFilesButton
 *     extensions={[".pptx", ".pro6", ".pro7"]}
 *     onFiles={(files) => uploadThem(files)}
 *   />
 *   <ElectronPickFolderButton
 *     extensions={[".pro6", ".pro7", ".xml"]}
 *     onFolder={(entries) => processImport(entries)}
 *   />
 *
 * The onFiles callback receives an array of { name, ext, base64, size } items
 * for files < 50MB. Larger files return {tooLarge:true}.
 */

import { useEffect, useState } from "react";

type PickedFile = {
  name: string;
  ext: string;
  size: number;
  base64?: string;
  absPath: string;
  tooLarge?: boolean;
};

function useIsElectron() {
  const [is, setIs] = useState(false);
  useEffect(() => {
    setIs(typeof window !== "undefined" && !!window.electronAPI);
  }, []);
  return is;
}

export function ElectronPickFilesButton({
  extensions,
  onFiles,
  label = "Choose from computer…",
  className = "",
}: {
  extensions: string[];
  onFiles: (files: PickedFile[]) => void;
  label?: string;
  className?: string;
}) {
  const isElectron = useIsElectron();
  if (!isElectron) return null;

  return (
    <button
      type="button"
      className={className || "h-9 px-3 rounded-md border text-xs font-semibold"}
      onClick={async () => {
        const api = window.electronAPI!;
        const exts = extensions.map((e) => (e.startsWith(".") ? e.slice(1) : e));
        const res = await api.dialog.openFile({
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "Supported files", extensions: exts }],
        });
        if (res.canceled || res.filePaths.length === 0) return;
        const files: PickedFile[] = [];
        for (const p of res.filePaths) {
          const f = await api.fs.readFile(p);
          if (f.tooLarge) {
            files.push({ name: p.split(/[\\/]/).pop() || p, ext: "", size: f.size, absPath: p, tooLarge: true });
          } else {
            files.push({ name: f.name, ext: f.ext, size: f.size, base64: f.base64, absPath: p });
          }
        }
        onFiles(files);
      }}
    >
      {label}
    </button>
  );
}

export function ElectronPickFolderButton({
  extensions,
  onFolder,
  label = "Import folder…",
  className = "",
}: {
  extensions: string[];
  onFolder: (entries: Array<{ absPath: string; relPath: string; size: number; ext: string }>) => void;
  label?: string;
  className?: string;
}) {
  const isElectron = useIsElectron();
  if (!isElectron) return null;

  return (
    <button
      type="button"
      className={className || "h-9 px-3 rounded-md border text-xs font-semibold"}
      onClick={async () => {
        const api = window.electronAPI!;
        const res = await api.dialog.openDirectory();
        if (res.canceled || res.filePaths.length === 0) return;
        const entries = await api.fs.readDirRecursive(res.filePaths[0], extensions);
        onFolder(entries);
      }}
    >
      {label}
    </button>
  );
}
