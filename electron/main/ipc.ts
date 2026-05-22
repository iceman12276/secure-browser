import { ipcMain } from 'electron';
import { coreVersion } from 'secure-browser-core';
import type { MainWindow } from './window';
import type { TabEvent } from './tabs/types';

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isTabId(value: unknown): value is string {
  return typeof value === 'string' && /^tab-\d+$/.test(value);
}

export function registerIpc(main: MainWindow): void {
  const { tabManager } = main;
  const relayout = () => (tabManager as unknown as { relayout: () => void }).relayout();

  // Smoke-test channel from Task 0 stays valid.
  ipcMain.handle('core:version', () => coreVersion());

  ipcMain.handle('tab:list', (): TabEvent => tabManager.getState());

  // Policy note: tab:new is intentionally lenient (falls back to a safe default
  // on bad/absent input), whereas nav:go is strict (throws on a bad url). Keep
  // this asymmetry — do not "fix" one to match the other.
  ipcMain.handle('tab:new', (_e, url: unknown) => {
    const target = isHttpUrl(url) ? url : 'https://example.com';
    const id = tabManager.newTab(target);
    relayout();
    return id;
  });

  ipcMain.handle('tab:close', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    tabManager.closeTab(id);
    relayout();
  });

  ipcMain.handle('tab:switch', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    tabManager.switchTab(id);
    relayout();
  });

  ipcMain.handle('nav:go', (_e, id: unknown, url: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    if (!isHttpUrl(url)) throw new Error('invalid url');
    tabManager.navigate(id, url);
  });

  ipcMain.handle('nav:back', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    const view = tabManager.viewOf(id);
    (view?.webContents as unknown as { goBack?: () => void } | undefined)?.goBack?.();
  });

  ipcMain.handle('nav:forward', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    const view = tabManager.viewOf(id);
    (view?.webContents as unknown as { goForward?: () => void } | undefined)?.goForward?.();
  });

  ipcMain.handle('nav:reload', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    const view = tabManager.viewOf(id);
    (view?.webContents as unknown as { reload?: () => void } | undefined)?.reload?.();
  });
}
