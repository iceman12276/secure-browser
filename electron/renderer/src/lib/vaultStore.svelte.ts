import type { CredentialMeta } from '../env';

class VaultStore {
  initialized = $state(false);
  unlocked = $state(false);
  credentials = $state<CredentialMeta[]>([]);
  error = $state<string | null>(null);
  awaitingSecondFactor = $state(false);
  mfaEnrolled = $state(false);

  async refreshStatus(): Promise<void> {
    const s = await window.secureBrowser.vault.status();
    this.initialized = s.initialized;
    this.unlocked = s.unlocked;
    const mfa = await window.secureBrowser.mfa.status();
    this.awaitingSecondFactor = mfa.awaitingSecondFactor;
    this.mfaEnrolled = mfa.enrolled;
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
  enrollTotp(): Promise<{ secretBase32: string; otpauthUrl: string; qrPngBase64: string }> {
    return window.secureBrowser.mfa.enrollTotp();
  }
  confirmTotp(code: string): Promise<boolean> {
    return window.secureBrowser.mfa.confirmTotp(code);
  }
  initAutoLock(onLock?: () => void): void {
    window.secureBrowser.onAutoLock(() => {
      this.unlocked = false;
      this.awaitingSecondFactor = false;
      this.credentials = [];
      this.error = 'Vault auto-locked after inactivity';
      onLock?.();
    });
  }
}

export const vaultStore = new VaultStore();
