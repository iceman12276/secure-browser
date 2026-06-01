import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { getChromePage } from './helpers';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let chrome: Page;
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-af-'));

// Two local origins via two HTTP servers.
let serverA: Server;
let serverB: Server;
let originA = '';
let originB = '';

function serve(file: string): Promise<{ server: Server; origin: string }> {
  const html = readFileSync(join(__dirname, 'fixtures', file), 'utf8');
  return new Promise((res) => {
    const server = createServer((_req, r) => {
      r.setHeader('content-type', 'text/html');
      r.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function navActiveTab(url: string): Promise<void> {
  await chrome.getByTestId('address-bar').fill(url);
  await chrome.getByTestId('address-bar').press('Enter');
  // Wait for the tab's webContents to finish loading the new URL.
  // Uses the same predicate as inTab (startsWith 'http://127.0.0.1') for consistency.
  // Register did-stop-loading BEFORE checking isLoading to avoid the race where the
  // load event fires between the isLoading check and the once() call.
  await app.evaluate(
    ({ webContents }, _targetUrl) =>
      new Promise<void>((resolve) => {
        const all = webContents.getAllWebContents();
        const tab = all.find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
        if (!tab) { resolve(); return; }
        tab.once('did-stop-loading', resolve);
        if (!tab.isLoading()) { resolve(); return; }
      }),
    url,
  );
}

/** Run JS inside the active TAB page (not the chrome view) via main.
 *  Returns undefined when no 127.0.0.1 tab is found yet (so expect.poll retries). */
function inTab<T>(fn: string): Promise<T | undefined> {
  return app.evaluate(({ webContents }, code) => {
    const all = webContents.getAllWebContents();
    const tab = all.find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
    if (!tab) return undefined;
    return tab.executeJavaScript(code) as Promise<unknown>;
  }, fn) as Promise<T | undefined>;
}

test.beforeAll(async () => {
  ({ server: serverA, origin: originA } = await serve('login.html'));
  ({ server: serverB, origin: originB } = await serve('other.html'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: join(__dirname, '..'),
  });
  // Capture the chrome Page ONCE before navigating any tab to a 127.0.0.1 fixture.
  // Safe because at launch the only 127.0.0.1-matching window is renderer/index.html
  // (the default tab opens duckduckgo.com, not a fixture URL).
  // Do NOT call getChromePage again after fixture nav: isChromeUrl also matches
  // 127.0.0.1, so a later call could return a tab page instead of the chrome UI.
  chrome = await getChromePage(app);
  await chrome.getByTestId('vault-sidebar').waitFor();

  // Create the vault and store a credential FOR originA only.
  await chrome.getByTestId('master-pw').fill('master-pw');
  await chrome.getByTestId('vault-submit').click();
  await chrome.getByTestId('add-origin').fill(originA);
  await chrome.getByTestId('add-username').fill('octocat');
  await chrome.getByTestId('add-secret').fill('s3cret!');
  await chrome.getByTestId('add-submit').click();
  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
});

test.afterAll(async () => {
  await app.close();
  serverA.close();
  serverB.close();
});

test('overlay appears on the matching origin and fills only after click', async () => {
  await navActiveTab(originA);

  // Password field starts empty (no auto-fill without a gesture).
  await expect.poll(() => inTab<string>(`document.querySelector('#pass').value`)).toBe('');

  // Overlay should appear (origin-matched candidate exists).
  await expect.poll(() => inTab<boolean>(`!!document.querySelector('[data-testid=autofill-overlay]')`)).toBe(true);

  // Click the candidate inside the tab page → triggers the single fill.
  await inTab<void>(`document.querySelector('[data-testid=autofill-candidate]').click()`);

  await expect.poll(() => inTab<string>(`document.querySelector('#pass').value`)).toBe('s3cret!');
  await expect.poll(() => inTab<string>(`document.querySelector('#user').value`)).toBe('octocat');
});

test('no overlay and no fill on a mismatched origin', async () => {
  await navActiveTab(originB);
  // originB has no stored credential → no overlay, password stays empty.
  await chrome.waitForTimeout(500);
  expect(await inTab<boolean>(`!!document.querySelector('[data-testid=autofill-overlay]')`)).toBe(false);
  expect(await inTab<string>(`document.querySelector('#pass').value`)).toBe('');
});

test('submitting a new credential triggers the save prompt', async () => {
  await navActiveTab(originB);
  await inTab<void>(`
    document.querySelector('#user').value = 'newuser';
    document.querySelector('#pass').value = 'newpass';
    document.querySelector('#loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  await expect(chrome.getByTestId('save-prompt')).toBeVisible();
  await chrome.getByTestId('save-accept').click();
  // The new credential for originB now exists in the vault list.
  await expect(chrome.getByTestId('cred-item')).toHaveCount(2);
});
