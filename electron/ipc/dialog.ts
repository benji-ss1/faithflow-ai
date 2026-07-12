import { ipcMain, dialog, BrowserWindow } from "electron";
import { authorizePath, authorizeDir } from "./fs";

export function registerDialogIpc() {
  ipcMain.handle("dialog:openFile", async (_e, options: Electron.OpenDialogOptions = {}) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openFile"], ...options })
      : await dialog.showOpenDialog({ properties: ["openFile"], ...options });
    if (!result.canceled) {
      for (const p of result.filePaths) authorizePath(p);
    }
    return result;
  });

  ipcMain.handle("dialog:openDirectory", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (!result.canceled) {
      for (const p of result.filePaths) authorizeDir(p);
    }
    return result;
  });

  ipcMain.handle("dialog:showMessage", async (_e, options: Electron.MessageBoxOptions) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  });
}
