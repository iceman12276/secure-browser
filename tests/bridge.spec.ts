import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { getChromePage, isChromeUrl } from './helpers';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  // Launch the built app from the project root (uses package.json "main").
  electronApp = await electron.launch({ args: ['.'], cwd: join(__dirname, '..') });
  window = await getChromePage(electronApp);
});

test.afterAll(async () => {
  await electronApp.close();
});

test('app window opens with the expected title', async () => {
  await expect(window).toHaveTitle('Secure Browser');
});

test('Rust core value crosses the bridge into the renderer', async () => {
  // The chrome UI no longer renders a `core-version` DOM element (M1 removed it),
  // but the preload bridge method still exists. Assert via the bridge directly.
  const value = await window.evaluate(
    async () =>
      await (window as unknown as { secureBrowser: { coreVersion: () => Promise<string> } }).secureBrowser.coreVersion(),
  );
  expect(value).toMatch(/^secure-browser-core \d+\.\d+\.\d+$/);
});

test('renderer is sandboxed: no Node access', async () => {
  const exposure = await window.evaluate(() => ({
    typeofRequire: typeof (globalThis as { require?: unknown }).require,
    typeofProcess: typeof (globalThis as { process?: unknown }).process,
    typeofModule: typeof (globalThis as { module?: unknown }).module,
    hasBridge: typeof (window as unknown as { secureBrowser?: unknown }).secureBrowser,
  }));
  expect(exposure.typeofRequire).toBe('undefined');
  expect(exposure.typeofProcess).toBe('undefined');
  expect(exposure.typeofModule).toBe('undefined');
  expect(exposure.hasBridge).toBe('object');
});

test('webPreferences are locked down', async () => {
  // M1 replaced BrowserWindow with a BaseWindow hosting WebContentsViews, so
  // BrowserWindow.getAllWindows() is empty. Inspect prefs via the webContents
  // module instead. Assert the chrome view (the one serving index.html / the
  // dev renderer URL) is sandboxed, and that EVERY webContents has
  // nodeIntegration off + contextIsolation on (the tab views are hardened too).
  // Identify the chrome webContents by the exact URL of the already-selected
  // chrome Page (chosen via the shared isChromeUrl predicate in getChromePage),
  // so this test and the page selection can't diverge.
  const chromeUrl = window.url();
  expect(isChromeUrl(chromeUrl)).toBe(true);
  const result = await electronApp.evaluate(({ webContents }, targetUrl) => {
    type Prefs = { nodeIntegration?: boolean; sandbox?: boolean; contextIsolation?: boolean };
    const all = webContents.getAllWebContents();
    const prefsOf = (wc: (typeof all)[number]): Prefs | null =>
      (wc as unknown as { getLastWebPreferences?: () => Prefs }).getLastWebPreferences?.() ?? null;
    const chrome = all.find((wc) => wc.getURL() === targetUrl);
    return {
      chrome: chrome ? prefsOf(chrome) : null,
      all: all.map((wc) => prefsOf(wc)),
    };
  }, chromeUrl);
  // Chrome view: full lockdown including sandbox.
  expect(result.chrome?.nodeIntegration).toBeFalsy();
  expect(result.chrome?.sandbox).toBe(true);
  expect(result.chrome?.contextIsolation).toBe(true);
  // Every webContents (chrome + tab views) is isolated with no Node integration.
  for (const wp of result.all) {
    expect(wp?.nodeIntegration).toBeFalsy();
    expect(wp?.contextIsolation).toBe(true);
  }
});
