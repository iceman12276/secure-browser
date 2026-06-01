/**
 * Updating an existing credential — when a stored login's password changes, the
 * manager should offer to save, and accepting must UPDATE the existing entry in
 * place, not create a duplicate. Drives the built app against a local login form.
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
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-update-'));
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
  ({ server, origin } = await serve('login.html'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: join(__dirname, '..', '..') });
  chrome = await getChromePage(app);
  await chrome.getByTestId('vault-sidebar').waitFor();
  await chrome.getByTestId('master-pw').fill('adminpassword');
  await chrome.getByTestId('vault-submit').click();
  // Pre-store a credential for this origin with the OLD password.
  await chrome.getByTestId('add-origin').fill(origin);
  await chrome.getByTestId('add-username').fill('octocat');
  await chrome.getByTestId('add-secret').fill('old-password');
  await chrome.getByTestId('add-submit').click();
  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
});

test.afterAll(async () => {
  await app?.close();
  server?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('changing the password for an existing login updates in place (no duplicate)', async () => {
  await navActiveTab(origin);
  await expect.poll(() => inTab<boolean>(`!!document.querySelector('#loginForm')`), { timeout: 8000 }).toBe(true);

  // Sign in with the SAME username but a NEW password.
  await inTab<void>(`
    document.querySelector('#user').value = 'octocat';
    document.querySelector('#pass').value = 'new-password';
    document.querySelector('#loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);

  await expect(chrome.getByTestId('save-prompt')).toBeVisible();
  // The prompt distinguishes a destructive overwrite from a new save.
  await expect(chrome.getByTestId('save-prompt')).toContainText(/update/i);
  await chrome.screenshot({ path: join(__dirname, 'screenshots', 'update-credential.png') });
  await chrome.getByTestId('save-accept').click();

  // Must UPDATE the existing entry, not add a second one.
  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
  await chrome.getByTestId('cred-reveal').click();
  await expect(chrome.getByTestId('cred-secret')).toHaveText('new-password');
});
