import type { CredentialMeta } from '../env';
import { registerSecurityKey, authenticateSecurityKey } from './webauthn';

class VaultStore {
  initialized = $state(false);
  unlocked = $state(false);
  credentials = $state<CredentialMeta[]>([]);
  error = $state<string | null>(null);
  awaitingSecondFactor = $state(false);
  mfaEnrolled = $state(false);
  totpEnrolled = $state(false);
  hasPasskey = $state(false);
  /** True while a native security-key ceremony is in flight (awaiting the user's touch). */
  webauthnBusy = $state(false);

  async refreshStatus(): Promise<void> {
    const s = await window.secureBrowser.vault.status();
    this.initialized = s.initialized;
    this.unlocked = s.unlocked;
    const mfa = await window.secureBrowser.mfa.status();
    this.awaitingSecondFactor = mfa.awaitingSecondFactor;
    this.mfaEnrolled = mfa.enrolled;
    this.totpEnrolled = mfa.totpEnrolled;
    this.hasPasskey = mfa.hasPasskey;
    if (this.unlocked && !this.awaitingSecondFactor) await this.refreshList();
  }

  async refreshList(): Promise<void> {
    this.credentials = await window.secureBrowser.vault.list();
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.error = null;
    try {
      await fn();
    } catch (e) {
      // Surface errors to the UI — never silently swallow (capstone lesson).
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  init(pw: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.init(pw);
      await this.refreshStatus();
    });
  }
  unlock(pw: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.unlock(pw);
      await this.refreshStatus();
    });
  }
  lock(): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.lock();
      this.unlocked = false;
      this.credentials = [];
    });
  }
  add(origin: string, username: string, secret: string, label: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.add(origin, username, secret, label);
      await this.refreshList();
    });
  }
  remove(id: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.delete(id);
      await this.refreshList();
    });
  }
  reveal(id: string): Promise<string> {
    return window.secureBrowser.vault.getSecret(id);
  }
  verifyTotp(code: string): Promise<void> {
    return this.run(async () => {
      const ok = await window.secureBrowser.mfa.verifyTotp(code);
      if (!ok) throw new Error('Invalid authentication code');
      await this.refreshStatus();
    });
  }
  enrollTotp() {
    return window.secureBrowser.mfa.enrollTotp();
  }
  confirmTotp(code: string): Promise<boolean> {
    return window.secureBrowser.mfa.confirmTotp(code);
  }
  /** Register a security key / passkey as a second factor (native CTAP2 ceremony). */
  registerWebauthn(): Promise<void> {
    return this.run(async () => {
      this.webauthnBusy = true;
      try {
        await registerSecurityKey();
        await this.refreshStatus();
      } finally {
        this.webauthnBusy = false;
      }
    });
  }
  /** Clear the awaiting-second-factor gate by asserting a registered security key. */
  authenticateWebauthn(): Promise<void> {
    return this.run(async () => {
      this.webauthnBusy = true;
      try {
        const ok = await authenticateSecurityKey();
        if (!ok) throw new Error('Security key was not accepted');
        await this.refreshStatus();
      } finally {
        this.webauthnBusy = false;
      }
    });
  }
  initAutoLock(): void {
    window.secureBrowser.onAutoLock(() => {
      this.unlocked = false;
      this.awaitingSecondFactor = false;
      this.credentials = [];
      this.error = 'Vault auto-locked after inactivity';
    });
  }
}

export const vaultStore = new VaultStore();
