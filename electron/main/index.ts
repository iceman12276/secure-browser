import { app } from 'electron';
import { createMainWindow, type MainWindow } from './window';
import { registerIpc } from './ipc';
import { AutoLock } from './autolock';

let main: MainWindow | null = null;

void app.whenReady().then(() => {
  main = createMainWindow();
  const autoLock = new AutoLock(main);
  registerIpc(main, autoLock);
  autoLock.start();
  // Open a default first tab.
  main.tabManager.newTab('https://example.com');
  (main.tabManager as unknown as { relayout: () => void }).relayout();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
