import { app } from 'electron';
import { createMainWindow, type MainWindow } from './window';
import { registerIpc } from './ipc';
import { AutoLock } from './autolock';
import { HOME_URL } from './constants';

let main: MainWindow | null = null;

void app.whenReady().then(() => {
  main = createMainWindow();
  const autoLock = new AutoLock(main);
  registerIpc(main, autoLock);
  autoLock.start();
  // Open a default first tab (the home page).
  main.tabManager.newTab(HOME_URL);
  (main.tabManager as unknown as { relayout: () => void }).relayout();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
