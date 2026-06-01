import { ipcMain } from 'electron';
import { coreVersion, fido2Register, fido2Authenticate } from 'secure-browser-core';
import { vault } from './vault';
import type { MainWindow } from './window';
import type { TabEvent } from './tabs/types';
import { registerAutofill } from './autofill';
import type { AutoLock } from './autolock';
import { HOME_URL } from './constants';

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

export function registerIpc(main: MainWindow, autoLock: AutoLock): void {
  const { tabManager } = main;
  const relayout = () => (tabManager as unknown as { relayout: () => void }).relayout();

  // Smoke-test channel from Task 0 stays valid.
  ipcMain.handle('core:version', () => coreVersion());

  ipcMain.handle('tab:list', (): TabEvent => tabManager.getState());

  // Policy note: tab:new is intentionally lenient (falls back to a safe default
  // on bad/absent input), whereas nav:go is strict (throws on a bad url). Keep
  // this asymmetry — do not "fix" one to match the other.
  ipcMain.handle('tab:new', (_e, url: unknown) => {
    const target = isHttpUrl(url) ? url : HOME_URL;
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

  ipcMain.handle('vault:status', () => ({
    initialized: vault.isInitialized(),
    unlocked: vault.isUnlocked(),
  }));
  ipcMain.handle('vault:init', (_e, pw: unknown) => {
    if (typeof pw !== 'string' || pw.length === 0) throw new Error('master password required');
    vault.initVault(pw);
  });
  ipcMain.handle('vault:unlock', (_e, pw: unknown) => {
    if (typeof pw !== 'string' || pw.length === 0) throw new Error('master password required');
    autoLock.touch();
    vault.unlock(pw);
  });
  ipcMain.handle('vault:lock', () => vault.lock());
  ipcMain.handle('vault:list', () => {
    autoLock.touch();
    return vault.list();
  });
  ipcMain.handle('vault:add', (_e, origin: unknown, username: unknown, secret: unknown, label: unknown) => {
    for (const v of [origin, username, secret]) {
      if (typeof v !== 'string' || v.length === 0) throw new Error('origin, username, secret required');
    }
    autoLock.touch();
    return vault.addCredential(origin as string, username as string, secret as string, (label as string) ?? '');
  });
  ipcMain.handle('vault:getSecret', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('credential id required');
    autoLock.touch();
    return vault.getSecret(id);
  });
  ipcMain.handle('vault:delete', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('credential id required');
    vault.delete(id);
  });

  ipcMain.handle('mfa:status', () => vault.mfaStatus());
  ipcMain.handle('mfa:enrollTotp', () => { autoLock.touch(); return vault.enrollTotp(); });
  ipcMain.handle('mfa:confirmTotp', (_e, code: unknown) => {
    if (typeof code !== 'string') throw new Error('code required');
    autoLock.touch();
    return vault.confirmTotp(code);
  });
  ipcMain.handle('mfa:verifyTotp', (_e, code: unknown) => {
    if (typeof code !== 'string') throw new Error('code required');
    autoLock.touch();
    return vault.verifyTotp(code);
  });
  ipcMain.handle('webauthn:startRegistration', () => { autoLock.touch(); return vault.startWebauthnRegistration(); });
  ipcMain.handle('webauthn:finishRegistration', (_e, response: unknown, state: unknown) => {
    if (typeof response !== 'string' || typeof state !== 'string') throw new Error('response+state required');
    autoLock.touch();
    return vault.finishWebauthnRegistration(response, state);
  });
  ipcMain.handle('webauthn:startAuthentication', () => { autoLock.touch(); return vault.startWebauthnAuthentication(); });
  ipcMain.handle('webauthn:finishAuthentication', (_e, response: unknown, state: unknown) => {
    if (typeof response !== 'string' || typeof state !== 'string') throw new Error('response+state required');
    autoLock.touch();
    return vault.finishWebauthnAuthentication(response, state);
  });

  // Native FIDO2 ceremony: drive the USB key in the Rust core (CTAP2 over HID),
  // bypassing the browser's navigator.credentials which Electron does not surface
  // on Linux/macOS (electron#24573). Input is the RP challenge JSON from
  // start*; output is the response JSON for finish*. These run the blocking
  // ceremony off-thread in the core (napi async).
  ipcMain.handle('webauthn:nativeRegister', (_e, challengeJson: unknown) => {
    if (typeof challengeJson !== 'string') throw new Error('challenge required');
    autoLock.touch();
    return fido2Register(challengeJson);
  });
  ipcMain.handle('webauthn:nativeAuthenticate', (_e, challengeJson: unknown) => {
    if (typeof challengeJson !== 'string') throw new Error('challenge required');
    autoLock.touch();
    return fido2Authenticate(challengeJson);
  });

  registerAutofill(main);
}
