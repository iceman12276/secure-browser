/**
 * Account-creation capture — proves the Chrome/Google-style "offer to save" flow
 * fires when a user CREATES AN ACCOUNT (a signup form with two password fields),
 * not just on login. Drives the built app against a local signup fixture.
 *
 * The form parser classifies >=2 password fields as a "signup"; on submit the
 * content script captures username+password and main offers to save it (if new).
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { getChromePage } from '../helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

let app: ElectronApplication;
let chrome: Page;
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-signup-'));
let server: Server;
let origin = '';

function serve(file: string): Promise<{ server: Server; origin: string }> {
  const html = readFileSync(join(__dirname, '..', 'fixtures', file), 'utf8');
  return new Promise((res) => {
    const s = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); });
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      res({ server: s, origin: `http://127.0.0.1:${p}` });
    });
  });
}

async function navActiveTab(url: string): Promise<void> {
  await chrome.getByTestId('address-bar').fill(url);
  await chrome.getByTestId('address-bar').press('Enter');
  await app.evaluate(
    ({ webContents }) =>
      new Promise<void>((resolve) => {
        const tab = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
        if (!tab) return resolve();
        tab.once('did-stop-loading', () => resolve());
        if (!tab.isLoading()) resolve();
      }),
  );
}

function inTab<T>(code: string): Promise<T | undefined> {
  return app.evaluate(({ webContents }, c) => {
    const tab = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
    if (!tab) return undefined;
    return tab.executeJavaScript(c) as Promise<unknown>;
  }, code) as Promise<T | undefined>;
}

test.beforeAll(async () => {
  ({ server, origin } = await serve('signup.html'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: join(__dirname, '..', '..') });
  chrome = await getChromePage(app);
  await chrome.getByTestId('vault-sidebar').waitFor();
  // Create + unlock the vault so capture is authorized.
  await chrome.getByTestId('master-pw').fill('adminpassword');
  await chrome.getByTestId('vault-submit').click();
  await chrome.getByTestId('add-form').waitFor({ state: 'visible' });
});

test.afterAll(async () => {
  await app?.close();
  server?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('creating an account is offered to be saved (signup form, two password fields)', async () => {
  await navActiveTab(origin);
  // Wait for the signup page to actually load in the tab before interacting
  // (address-bar nav can resolve before the new tab URL commits).
  await expect.poll(() => inTab<boolean>(`!!document.querySelector('#signupForm')`), { timeout: 8000 }).toBe(true);

  // A real new user filling out a signup form, then submitting.
  await inTab<void>(`
    document.querySelector('#email').value = 'ada@example.com';
    document.querySelector('#new-password').value = 'Sup3r-Secret-Pw!';
    document.querySelector('#confirm-password').value = 'Sup3r-Secret-Pw!';
    document.querySelector('#signupForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);

  // The browser offers to save the brand-new credential — Chrome/Google behavior.
  await expect(chrome.getByTestId('save-prompt')).toBeVisible();
  await expect(chrome.getByTestId('save-prompt')).toContainText('ada@example.com');
  await chrome.screenshot({ path: join(__dirname, 'screenshots', 'signup-save.png') });

  // Accepting stores it in the vault under the email as the username.
  await chrome.getByTestId('save-accept').click();
  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
  await expect(chrome.getByTestId('cred-username')).toHaveText('ada@example.com');
});
