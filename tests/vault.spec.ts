import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromePage } from './helpers';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let chrome: Page;
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-e2e-'));

async function launch(): Promise<void> {
  // Force a clean, isolated userData dir so the vault starts uninitialized,
  // and reuse the SAME dir across relaunch to test persistence.
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: join(__dirname, '..'),
  });
  // A default https://example.com tab opens on launch, so there are >=2 pages
  // and app.firstWindow() races. Select the chrome UI page deterministically.
  chrome = await getChromePage(app);
  await chrome.getByTestId('vault-sidebar').waitFor();
}

test.afterEach(async () => {
  await app.close();
});

test('create vault, add a credential, reveal it', async () => {
  await launch();
  // First run → "Create vault".
  await expect(chrome.getByTestId('vault-submit')).toHaveText('Create');
  await chrome.getByTestId('master-pw').fill('master-pw-123');
  await chrome.getByTestId('vault-submit').click();

  // Add a credential.
  await chrome.getByTestId('add-origin').fill('https://github.com');
  await chrome.getByTestId('add-username').fill('octocat');
  await chrome.getByTestId('add-secret').fill('s3cret!');
  await chrome.getByTestId('add-submit').click();

  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
  await expect(chrome.getByTestId('cred-username')).toHaveText('octocat');

  await chrome.getByTestId('cred-reveal').click();
  await expect(chrome.getByTestId('cred-secret')).toHaveText('s3cret!');
});

test('relaunch, unlock, and read the credential back', async () => {
  await launch();
  // Vault already initialized from the previous test → "Unlock".
  await expect(chrome.getByTestId('vault-submit')).toHaveText('Unlock');
  await chrome.getByTestId('master-pw').fill('master-pw-123');
  await chrome.getByTestId('vault-submit').click();

  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
  await chrome.getByTestId('cred-reveal').click();
  await expect(chrome.getByTestId('cred-secret')).toHaveText('s3cret!');
});

test('wrong master password surfaces an error', async () => {
  await launch();
  await chrome.getByTestId('master-pw').fill('WRONG-pw');
  await chrome.getByTestId('vault-submit').click();
  await expect(chrome.getByTestId('vault-error')).toContainText(/wrong master password/i);
});
