import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateSync } from 'otplib';
import { getChromePage } from './helpers';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let chrome: Page;
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-mfa-'));
let totpSecret = '';

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: join(__dirname, '..') });
  chrome = await getChromePage(app);
  await chrome.getByTestId('vault-sidebar').waitFor();
}

test.afterEach(async () => {
  await app.close();
});

test.afterAll(() => {
  // Clean up the temp userData dir so sb-mfa-* dirs don't linger in /tmp.
  rmSync(userDataDir, { recursive: true, force: true });
});

test('enroll TOTP on a freshly created vault', async () => {
  await launch();
  await chrome.getByTestId('master-pw').fill('master-pw');
  await chrome.getByTestId('vault-submit').click();

  // Both enrollment affordances are offered on a fresh vault. The security-key
  // button must be reachable here AND after a factor exists (it is no longer
  // hidden once enrolled) — regression guard for the WebAuthn register entry point.
  await expect(chrome.getByTestId('totp-begin')).toBeVisible();
  await expect(chrome.getByTestId('webauthn-register')).toBeVisible();

  await chrome.getByTestId('totp-begin').click();
  // Read the enrollment secret from the <small> element inside mfa-enroll.
  // Targeting <small> avoids capturing surrounding button text that shares
  // uppercase characters with the base32 alphabet.
  totpSecret = (await chrome.locator('[data-testid="mfa-enroll"] small').textContent())!
    .replace('Secret:', '').trim();

  const code = generateSync({ secret: totpSecret });
  await chrome.getByTestId('totp-confirm-code').fill(code);
  await chrome.getByTestId('totp-confirm').click();
  await expect(chrome.getByTestId('mfa-enrolled')).toBeVisible();
  // Regression guard for the HIGH finding: the register button stays reachable
  // after a factor is enrolled, so an existing vault can still add a security key.
  await expect(chrome.getByTestId('webauthn-register')).toBeVisible();
});

test('relaunch requires master password AND TOTP', async () => {
  await launch();
  // Phase 1: master password.
  await expect(chrome.getByTestId('vault-submit')).toHaveText('Unlock');
  await chrome.getByTestId('master-pw').fill('master-pw');
  await chrome.getByTestId('vault-submit').click();

  // Phase 2: TOTP prompt appears; the vault is NOT yet usable.
  await expect(chrome.getByTestId('mfa-prompt')).toBeVisible();

  // Wrong code stays locked.
  await chrome.getByTestId('totp-code').fill('000000');
  await chrome.getByTestId('totp-verify').click();
  await expect(chrome.getByTestId('mfa-prompt')).toBeVisible();

  // Correct code unlocks.
  const code = generateSync({ secret: totpSecret });
  await chrome.getByTestId('totp-code').fill(code);
  await chrome.getByTestId('totp-verify').click();
  await expect(chrome.getByTestId('mfa-enroll')).toBeVisible(); // unlocked content visible
});
