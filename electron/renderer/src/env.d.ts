/// <reference types="svelte" />
import type { TabEvent, TabId } from '../../main/tabs/types';
import type { SavePrompt } from '../../content/messages';

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
    saveFromPrompt: (p: SavePrompt) => Promise<string>;
  };
  onTabEvent: (cb: (event: TabEvent) => void) => () => void;
  onSavePrompt: (cb: (p: SavePrompt) => void) => () => void;
  mfa: {
    status: () => Promise<{
      enrolled: boolean;
      awaitingSecondFactor: boolean;
      totpEnrolled: boolean;
      hasPasskey: boolean;
    }>;
    enrollTotp: () => Promise<{ secretBase32: string; otpauthUrl: string; qrPngBase64: string }>;
    confirmTotp: (code: string) => Promise<boolean>;
    verifyTotp: (code: string) => Promise<boolean>;
  };
  webauthn: {
    startRegistration: () => Promise<{ challengeJson: string; stateJson: string }>;
    finishRegistration: (response: string, state: string) => Promise<void>;
    startAuthentication: () => Promise<{ challengeJson: string; stateJson: string }>;
    finishAuthentication: (response: string, state: string) => Promise<boolean>;
    nativeRegister: (challengeJson: string) => Promise<string>;
    nativeAuthenticate: (challengeJson: string) => Promise<string>;
  };
  onAutoLock: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    secureBrowser: SecureBrowserApi;
  }
}

export {};
