import { contextBridge, ipcRenderer } from 'electron';
import type { TabEvent, TabId } from '../main/tabs/types';

const api = {
  coreVersion: (): Promise<string> => ipcRenderer.invoke('core:version'),
  tabs: {
    list: (): Promise<TabEvent> => ipcRenderer.invoke('tab:list'),
    new: (url?: string): Promise<TabId> => ipcRenderer.invoke('tab:new', url),
    close: (id: TabId): Promise<void> => ipcRenderer.invoke('tab:close', id),
    switch: (id: TabId): Promise<void> => ipcRenderer.invoke('tab:switch', id),
  },
  nav: {
    go: (id: TabId, url: string): Promise<void> => ipcRenderer.invoke('nav:go', id, url),
    back: (id: TabId): Promise<void> => ipcRenderer.invoke('nav:back', id),
    forward: (id: TabId): Promise<void> => ipcRenderer.invoke('nav:forward', id),
    reload: (id: TabId): Promise<void> => ipcRenderer.invoke('nav:reload', id),
  },
  /** Subscribe to tab-state pushes. Returns an unsubscribe fn. */
  onTabEvent: (cb: (event: TabEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: TabEvent): void => cb(event);
    ipcRenderer.on('tab:event', listener);
    return () => ipcRenderer.removeListener('tab:event', listener);
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('secureBrowser', api);
} else {
  throw new Error('contextIsolation is disabled — refusing to expose bridge insecurely');
}
