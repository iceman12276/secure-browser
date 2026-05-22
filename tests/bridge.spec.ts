import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  // Launch the built app from the project root (uses package.json "main").
  electronApp = await electron.launch({ args: ['.'], cwd: join(__dirname, '..') });
  window = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
});

test('app window opens with the expected title', async () => {
  await expect(window).toHaveTitle('Secure Browser');
});

test('Rust core value crosses the bridge into the renderer', async () => {
  const text = await window.getByTestId('core-version').textContent();
  expect(text).toMatch(/^secure-browser-core \d+\.\d+\.\d+$/);
});

test('renderer is sandboxed: no Node access', async () => {
  const exposure = await window.evaluate(() => ({
    typeofRequire: typeof (globalThis as { require?: unknown }).require,
    typeofProcess: typeof (globalThis as { process?: unknown }).process,
    typeofModule: typeof (globalThis as { module?: unknown }).module,
    hasBridge: typeof window.secureBrowser,
  }));
  expect(exposure.typeofRequire).toBe('undefined');
  expect(exposure.typeofProcess).toBe('undefined');
  expect(exposure.typeofModule).toBe('undefined');
  expect(exposure.hasBridge).toBe('object');
});

test('webPreferences are locked down', async () => {
  const wp = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return (win.webContents as unknown as {
      getLastWebPreferences?: () => { nodeIntegration?: boolean; sandbox?: boolean; contextIsolation?: boolean };
    }).getLastWebPreferences?.() ?? null;
  });
  expect(wp?.nodeIntegration).toBeFalsy();
  expect(wp?.sandbox).toBe(true);
  expect(wp?.contextIsolation).toBe(true);
});
