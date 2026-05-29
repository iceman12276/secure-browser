import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
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

test('enroll TOTP on a freshly created vault', async () => {
  await launch();
  await chrome.getByTestId('master-pw').fill('master-pw');
  await chrome.getByTestId('vault-submit').click();

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
