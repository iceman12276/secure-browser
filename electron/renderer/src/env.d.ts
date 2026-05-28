/// <reference types="svelte" />
import type { TabEvent, TabId } from '../../main/tabs/types';

export interface CredentialMeta {
  id: string;
  origin: string;
  username: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}

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
  vault: {
    status: () => Promise<{ initialized: boolean; unlocked: boolean }>;
    init: (pw: string) => Promise<void>;
    unlock: (pw: string) => Promise<void>;
    lock: () => Promise<void>;
    list: () => Promise<CredentialMeta[]>;
    add: (origin: string, username: string, secret: string, label: string) => Promise<string>;
    getSecret: (id: string) => Promise<string>;
    delete: (id: string) => Promise<void>;
  };
  onTabEvent: (cb: (event: TabEvent) => void) => () => void;
}

declare global {
  interface Window {
    secureBrowser: SecureBrowserApi;
  }
}

export {};
