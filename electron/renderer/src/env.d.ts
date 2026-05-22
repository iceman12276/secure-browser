/// <reference types="svelte" />

export interface SecureBrowserApi {
  /** Returns the Rust core version string, proving the bridge works. */
  coreVersion: () => Promise<string>;
}

declare global {
  interface Window {
    secureBrowser: SecureBrowserApi;
  }
}

export {};
