/**
 * Human-path address-bar test. Unlike connectivity.spec (which calls
 * tab.loadURL directly and bypasses the omnibox), this drives the REAL address
 * bar the way a person does: type text, press Enter, see what loads.
 *
 * Regression under test: typing a bare word like "github" used to become
 * "https://github/" and fail with ERR_NAME_NOT_RESOLVED. It must now run a web
 * search, while "github.com" navigates straight to the site.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { getChromePage } from '../helpers';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

test.setTimeout(90_000);

const SHOTS = join(__dirname, 'screenshots');
// Isolated userData so this test never collides with a running dev instance
// (shared Chromium/SQLite locks) and never touches the user's real vault.
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-omni-'));

let app: ElectronApplication;
let chrome: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: join(__dirname, '..', '..') });
  chrome = await getChromePage(app);
});
test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

/** Read the active (non-chrome) tab's committed URL + title. */
async function activeTab(): Promise<{ url: string; title: string }> {
  return app.evaluate(({ webContents }) => {
    const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
    return tab ? { url: tab.getURL(), title: tab.getTitle() } : { url: '', title: '' };
  });
}

/** Type into the real address bar, press Enter, wait for the tab to settle. */
async function typeAndGo(text: string, expectUrlContains: string): Promise<{ url: string; title: string }> {
  await chrome.getByTestId('address-bar').fill(text);
  await chrome.getByTestId('address-bar').press('Enter');
  await expect.poll(async () => (await activeTab()).url, { timeout: 30_000 }).toContain(expectUrlContains);
  // let the page finish painting before we read the title / screenshot
  await app.evaluate(async ({ webContents }) => {
    const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
    if (tab && tab.isLoading()) await new Promise<void>((r) => tab.once('did-stop-loading', () => r()));
  });
  return activeTab();
}

async function captureTab(name: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      const b64 = await app.evaluate(async ({ webContents }) => {
        const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
        return tab ? (await tab.capturePage()).toPNG().toString('base64') : null;
      });
      if (b64) {
        writeFileSync(join(SHOTS, name), Buffer.from(b64, 'base64'));
        return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

test('bare word "github" runs a web search (regression)', async () => {
  const r = await typeAndGo('github', 'duckduckgo.com');
  console.log(`[omnibox] "github" → url=${r.url} title="${r.title}"`);
  expect(r.url).toContain('duckduckgo.com');
  expect(r.url).toContain('github'); // the query made it into the search URL
  expect(r.url).not.toContain('https://github/'); // the old broken form is gone
  await captureTab('OMNI-1-github-search.png');
});

test('"github.com" navigates straight to the site', async () => {
  const r = await typeAndGo('github.com', 'github.com');
  console.log(`[omnibox] "github.com" → url=${r.url} title="${r.title}"`);
  expect(r.url).toMatch(/^https:\/\/github\.com/);
  expect(r.url).not.toContain('duckduckgo');
  await captureTab('OMNI-2-github-site.png');
});
