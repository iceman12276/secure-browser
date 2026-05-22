/// <reference types="svelte" />
import type { TabEvent, TabId } from '../../main/tabs/types';

export interface SecureBrowserApi {
  coreVersion: () => Promise<string>;
  tabs: {
    list: () => Promise<TabEvent>;
    new: (url?: string) => Promise<TabId>;
    close: (id: TabId) => Promise<void>;
    switch: (id: TabId) => Promise<void>;
  };
  nav: {
    go: (id: TabId, url: string) => Promise<void>;
    back: (id: TabId) => Promise<void>;
    forward: (id: TabId) => Promise<void>;
    reload: (id: TabId) => Promise<void>;
  };
  onTabEvent: (cb: (event: TabEvent) => void) => () => void;
}

declare global {
  interface Window {
    secureBrowser: SecureBrowserApi;
  }
}

export {};
