/**
 * Multi-step (username-first) login — Google-style: enter the email on step 1,
 * then the password field is injected dynamically on "Next". Proves the manager
 * (a) detects a form that appears AFTER load (MutationObserver re-scan) and
 * (b) carries the step-1 username into the save, even though the step-2 form has
 * no username field of its own (username-first memory).
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
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-multistep-'));
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
  ({ server, origin } = await serve('multistep.html'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: join(__dirname, '..', '..') });
  chrome = await getChromePage(app);
  await chrome.getByTestId('vault-sidebar').waitFor();
  await chrome.getByTestId('master-pw').fill('adminpassword');
  await chrome.getByTestId('vault-submit').click();
  await chrome.getByTestId('add-form').waitFor({ state: 'visible' });
});

test.afterAll(async () => {
  await app?.close();
  server?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('username-first flow: password injected on step 2 still saves with the step-1 username', async () => {
  await navActiveTab(origin);
  await expect.poll(() => inTab<boolean>(`!!document.querySelector('#email')`), { timeout: 8000 }).toBe(true);

  // Step 1: type the email (fires input so the manager remembers it), then Next.
  await inTab<void>(`
    const e = document.querySelector('#email');
    e.value = 'neo@example.com';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#next').click();
  `);

  // Step 2: the password form is injected dynamically — wait for it + the re-scan.
  await expect.poll(() => inTab<boolean>(`!!document.querySelector('#pw')`), { timeout: 8000 }).toBe(true);
  await chrome.waitForTimeout(300); // let the MutationObserver-driven re-scan wire the new form

  await inTab<void>(`
    document.querySelector('#pw').value = 'trinity-pw';
    document.querySelector('#pwForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);

  // The save offer must carry the step-1 username, not be empty.
  await expect(chrome.getByTestId('save-prompt')).toBeVisible();
  await expect(chrome.getByTestId('save-prompt')).toContainText('neo@example.com');
  await chrome.screenshot({ path: join(__dirname, 'screenshots', 'multistep-save.png') });

  await chrome.getByTestId('save-accept').click();
  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
  await expect(chrome.getByTestId('cred-username')).toHaveText('neo@example.com');
});
