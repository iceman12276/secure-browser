import { contextBridge, ipcRenderer } from 'electron';
import type { TabEvent, TabId } from '../main/tabs/types';

interface CredentialMetaDto {
  id: string;
  origin: string;
  username: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}

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
  vault: {
    status: (): Promise<{ initialized: boolean; unlocked: boolean }> =>
      ipcRenderer.invoke('vault:status'),
    init: (pw: string): Promise<void> => ipcRenderer.invoke('vault:init', pw),
    unlock: (pw: string): Promise<void> => ipcRenderer.invoke('vault:unlock', pw),
    lock: (): Promise<void> => ipcRenderer.invoke('vault:lock'),
    list: (): Promise<CredentialMetaDto[]> => ipcRenderer.invoke('vault:list'),
    add: (origin: string, username: string, secret: string, label: string): Promise<string> =>
      ipcRenderer.invoke('vault:add', origin, username, secret, label),
    getSecret: (id: string): Promise<string> => ipcRenderer.invoke('vault:getSecret', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('vault:delete', id),
    saveFromPrompt: (p: { origin: string; username: string; secret: string }): Promise<string> =>
      ipcRenderer.invoke('vault:saveFromPrompt', p),
  },
  /** Subscribe to tab-state pushes. Returns an unsubscribe fn. */
  onTabEvent: (cb: (event: TabEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: TabEvent): void => cb(event);
    ipcRenderer.on('tab:event', listener);
    return () => ipcRenderer.removeListener('tab:event', listener);
  },
  /** Subscribe to save-prompt pushes from main. Returns an unsubscribe fn. */
  onSavePrompt: (cb: (p: { origin: string; username: string; secret: string }) => void): (() => void) => {
    const listener = (_e: unknown, p: { origin: string; username: string; secret: string }): void => cb(p);
    ipcRenderer.on('autofill:save-prompt', listener);
    return () => ipcRenderer.removeListener('autofill:save-prompt', listener);
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('secureBrowser', api);
} else {
  throw new Error('contextIsolation is disabled — refusing to expose bridge insecurely');
}
