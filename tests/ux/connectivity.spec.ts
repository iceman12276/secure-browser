/**
 * Connectivity probe — does the browser shell actually load LIVE internet sites?
 * Drives the built app, navigates a real tab to public URLs, and reads back the
 * tab's real URL + title + on-page text (proof the page actually loaded, not
 * just that the address bar was set), then captures the rendered tab.
 *
 * Note: tabs are native WebContentsView overlays, so we inspect/capture them via
 * the main process (webContents), not via a Playwright Page.
 */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

test.setTimeout(60_000);

const SHOTS = join(__dirname, 'screenshots');

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], cwd: join(__dirname, '..', '..') });
});
test.afterAll(async () => {
  await app?.close();
});

/** Navigate the active (non-chrome) tab and wait for it to finish loading. */
async function navAndWait(url: string): Promise<{ url: string; title: string; ok: boolean; failure: string | null }> {
  return app.evaluate(async ({ webContents }, target) => {
    const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
    if (!tab) return { url: '', title: '', ok: false, failure: 'no tab webContents found' };
    let failure: string | null = null;
    const onFail = (_e: unknown, _code: number, desc: string): void => {
      failure = desc;
    };
    tab.on('did-fail-load', onFail);
    await tab.loadURL(target); // resolves on success, rejects on hard failure
    await new Promise<void>((r) => (tab.isLoading() ? tab.once('did-stop-loading', () => r()) : r()));
    tab.off('did-fail-load', onFail);
    return { url: tab.getURL(), title: tab.getTitle(), ok: failure === null, failure };
  }, url);
}

async function readInTab<T>(code: string): Promise<T> {
  return app.evaluate(({ webContents }, c) => {
    const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
    return tab!.executeJavaScript(c) as Promise<unknown>;
  }, code) as Promise<T>;
}

/** Best-effort tab capture. capturePage() can transiently throw UnknownVizError
 *  on Linux right after a load (compositor not ready); retry a few times, but
 *  never let a screenshot hiccup fail the connectivity assertion. */
async function captureTab(name: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      const b64 = await app.evaluate(async ({ webContents }) => {
        const tab = webContents.getAllWebContents().find((wc) => !wc.getURL().includes('index.html'));
        if (!tab) return null;
        return (await tab.capturePage()).toPNG().toString('base64');
      });
      if (b64) {
        writeFileSync(join(SHOTS, name), Buffer.from(b64, 'base64'));
        return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500)); // let the compositor settle, then retry
    }
  }
  console.log(`[connectivity] could not capture ${name} (compositor); connectivity itself is unaffected`);
}

test('loads a live external site (example.com) over the real internet', async () => {
  const r = await navAndWait('https://example.com');
  console.log(`[connectivity] example.com → url=${r.url} title="${r.title}" ok=${r.ok} failure=${r.failure ?? 'none'}`);
  const h1 = await readInTab<string>(`document.querySelector('h1')?.innerText ?? ''`);
  const bodyLen = await readInTab<number>(`document.body.innerText.length`);
  console.log(`[connectivity] example.com h1="${h1}" bodyTextLen=${bodyLen}`);

  // Proof of a real load: the page's own <h1> text came back from the live document.
  expect(r.url).toContain('example.com');
  expect(r.title).toMatch(/example domain/i);
  expect(h1).toMatch(/example domain/i);
  expect(bodyLen).toBeGreaterThan(50);

  await captureTab('NET-1-example-com.png'); // best-effort visual evidence
});

test('loads a second, content-rich live site (wikipedia.org)', async () => {
  const r = await navAndWait('https://www.wikipedia.org');
  console.log(`[connectivity] wikipedia → url=${r.url} title="${r.title}" ok=${r.ok} failure=${r.failure ?? 'none'}`);
  const linkCount = await readInTab<number>(`document.querySelectorAll('a').length`);
  console.log(`[connectivity] wikipedia anchor count=${linkCount}`);

  expect(r.title).toMatch(/wikipedia/i);
  expect(linkCount).toBeGreaterThan(10); // a real, fully-rendered page has many links

  await captureTab('NET-2-wikipedia.png'); // best-effort visual evidence
});
