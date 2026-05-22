import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { getChromePage } from './helpers';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let chrome: Page; // the chrome UI page (tab strip + toolbar)

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], cwd: join(__dirname, '..') });
  chrome = await getChromePage(app);
  await chrome.getByTestId('tab-strip').waitFor();
});

test.afterAll(async () => {
  await app.close();
});

test('starts with one tab', async () => {
  await expect(chrome.getByTestId('tab')).toHaveCount(1);
});

test('opens a second tab and navigates it', async () => {
  await chrome.getByTestId('tab-new').click();
  await expect(chrome.getByTestId('tab')).toHaveCount(2);

  await chrome.getByTestId('address-bar').fill('example.org');
  await chrome.getByTestId('address-bar').press('Enter');

  await expect
    .poll(async () =>
      app.evaluate(({ webContents }) =>
        webContents.getAllWebContents().map((wc) => wc.getURL()).join(' '),
      ),
    )
    .toContain('example.org');
});

test('back/forward navigation works on the active tab', async () => {
  await chrome.getByTestId('address-bar').fill('example.com');
  await chrome.getByTestId('address-bar').press('Enter');
  await expect
    .poll(async () =>
      app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => wc.getURL()).join(' ')),
    )
    .toContain('example.com');

  await chrome.getByTestId('nav-back').click();
  await expect
    .poll(async () =>
      app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => wc.getURL()).join(' ')),
    )
    .toContain('example.org');
});

test('closing a tab reduces the count', async () => {
  const closeButtons = chrome.getByTestId('tab-close');
  await closeButtons.first().click();
  await expect(chrome.getByTestId('tab')).toHaveCount(1);
});

test('tab page renderers are sandboxed: no Node access', async () => {
  const hasNode = await app.evaluate(({ webContents }) => {
    const all = webContents.getAllWebContents();
    const tab = all.find((wc) => !wc.getURL().includes('index.html'));
    return tab ? tab.executeJavaScript('typeof require + "," + typeof module') : 'no-tab';
  });
  expect(hasNode).toBe('undefined,undefined');
});
