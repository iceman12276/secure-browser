import { contextBridge, ipcRenderer } from 'electron';

// Minimal, allow-listed bridge. Only named channels are reachable.
const api = {
  coreVersion: (): Promise<string> => ipcRenderer.invoke('core:version'),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('secureBrowser', api);
} else {
  // contextIsolation must be ON; fail loudly if a misconfigured window loads us.
  throw new Error('contextIsolation is disabled — refusing to expose bridge insecurely');
}
