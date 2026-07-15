// Global type declarations for the Electron preload bridge (window.electronAPI).
// Available only when the app is running inside the Electron shell.

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  rotation: number;
  internal: boolean;
  isPrimary: boolean;
}

export interface ElectronAPI {
  screens: {
    list: () => Promise<DisplayInfo[]>;
    assign: (displayId: number, role: string, presetOrResolution: string, obsMode?: string) => Promise<{ ok: boolean }>;
    spawn: (role: string) => Promise<{ ok: boolean; displayId?: number; preset?: string }>;
    close: (role: string) => Promise<{ ok: boolean }>;
  };
  audio: {
    listInputs: () => Promise<any>;
    listSystemSources: () => Promise<Array<{ id: string; name: string; display_id: string }> | { error: string; sources: any[] }>;
  };
  dialog: {
    openFile: (options?: any) => Promise<{ canceled: boolean; filePaths: string[] }>;
    openDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>;
    showMessage: (options: any) => Promise<any>;
  };
  fs: {
    readDirRecursive: (
      dirPath: string,
      extensions: string[]
    ) => Promise<Array<{ absPath: string; relPath: string; size: number; ext: string }>>;
    readFile: (
      filePath: string
    ) => Promise<
      | { tooLarge: false; size: number; base64: string; name: string; ext: string }
      | { tooLarge: true; size: number; error: string }
    >;
  };
  app: {
    version: () => Promise<string>;
    platform: () => Promise<NodeJS.Platform>;
  };
  shell: {
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  };
  license?: {
    get: () => Promise<{ ok: boolean; key: string | null; reason?: string }>;
    set: (key: string) => Promise<{ ok: boolean; reason?: string }>;
    clear: () => Promise<{ ok: boolean; reason?: string }>;
  };
  update?: {
    onAvailable: (cb: (info: { version: string; releaseDate: string }) => void) => () => void;
    onDownloaded: (cb: (info: { version: string }) => void) => () => void;
    onError: (cb: (info: { message: string }) => void) => () => void;
    installNow: () => Promise<{ ok: boolean; error?: string }>;
  };
  on: (channel: string, handler: (...args: any[]) => void) => void;
  off: (channel: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
