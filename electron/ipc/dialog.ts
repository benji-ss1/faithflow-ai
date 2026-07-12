import { ipcMain, dialog, BrowserWindow } from "electron";

export function registerDialogIpc() {
  ipcMain.handle("dialog:openFile", async (_e, options: Electron.OpenDialogOptions = {}) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openFile"], ...options })
      : await dialog.showOpenDialog({ properties: ["openFile"], ...options });
    return result;
  });

  ipcMain.handle("dialog:openDirectory", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result;
  });

  ipcMain.handle("dialog:showMessage", async (_e, options: Electron.MessageBoxOptions) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  });
}
