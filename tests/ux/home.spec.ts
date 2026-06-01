/**
 * Home page test. On launch the browser opens a default tab — it must now land
 * on DuckDuckGo (a usable search box), not the old example.com placeholder.
 * Drives the BUILT app and reads the real committed URL + title of the tab the
 * app opened by itself (no navigation by the test).
 */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

test.setTimeout(60_000);

const SHOTS = join(__dirname, 'screenshots');
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-home-'));

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: join(__dirname, '..', '..') });
});
test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('opens to DuckDuckGo as the home page', async () => {
  // Wait for the app's own default tab to commit + finish loading. No nav here.
  const info = await app.evaluate(async ({ webContents }) => {
    const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
    if (!tab) return { url: '', title: '' };
    if (tab.getURL() === '' || tab.isLoading()) {
      await new Promise<void>((r) => tab.once('did-stop-loading', () => r()));
    }
    return { url: tab.getURL(), title: tab.getTitle() };
  });
  console.log(`[home] default tab → url=${info.url} title="${info.title}"`);

  expect(info.url).toContain('duckduckgo.com');
  expect(info.url).not.toContain('example.com');
  expect(info.title).toMatch(/duckduckgo/i);

  for (let i = 0; i < 4; i++) {
    try {
      const b64 = await app.evaluate(async ({ webContents }) => {
        const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
        return tab ? (await tab.capturePage()).toPNG().toString('base64') : null;
      });
      if (b64) {
        writeFileSync(join(SHOTS, 'HOME-duckduckgo.png'), Buffer.from(b64, 'base64'));
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
});
